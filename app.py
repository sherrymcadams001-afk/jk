# app.py
import os
import time
import uuid
import re
import threading
import json
import base64
import logging
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from dotenv import load_dotenv
import requests
import pandas as pd
from io import BytesIO

# --- Constants ---
MAX_RECIPIENTS = 1000
DEFAULT_INTERVAL = 4
MIN_INTERVAL = 1
MAX_INTERVAL = 20

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(threadName)s - %(message)s', # Added threadName
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# --- Load Environment Variables ---
load_dotenv()

# --- Flask App Initialization ---
app = Flask(__name__, static_folder='static', template_folder='templates')
CORS(app)
app.logger.handlers.clear() # Use root logger handlers configured above
app.logger.addHandler(logging.StreamHandler()) # Ensure logs go to console
app.logger.setLevel(logging.INFO)

# --- SMTP2GO API Configuration & Validation ---
SMTP2GO_API_URL = (os.getenv("SMTP2GO_API_URL") or "").rstrip('/')
SMTP2GO_API_KEY = os.getenv("SMTP2GO_API_KEY")
DEFAULT_SENDER_EMAIL = os.getenv("DEFAULT_SENDER_EMAIL")
DEFAULT_SENDER_NAME = os.getenv("DEFAULT_SENDER_NAME")

# Build endpoint for sending emails
SMTP2GO_SEND_ENDPOINT = f"{SMTP2GO_API_URL}/email/send" if SMTP2GO_API_URL else None

missing_configs = []
if not SMTP2GO_API_URL: missing_configs.append("SMTP2GO_API_URL")
if not SMTP2GO_API_KEY: missing_configs.append("SMTP2GO_API_KEY")
if not DEFAULT_SENDER_EMAIL: missing_configs.append("DEFAULT_SENDER_EMAIL")
if not DEFAULT_SENDER_NAME: missing_configs.append("DEFAULT_SENDER_NAME")

if missing_configs:
    error_message = f"CRITICAL CONFIG ERROR: Missing ENV VARS: {', '.join(missing_configs)}."
    logger.critical(error_message)
    # In production, consider preventing startup when critical configs are missing.

# --- API Headers ---
BASE_HEADERS = {
    'accept': "application/json",
    'content-type': 'application/json'
}
if not SMTP2GO_API_KEY:
    logger.warning("SMTP2GO API Key missing. API calls WILL fail.")

# --- Global State (Needs Lock) ---
# WARNING: In-memory storage not suitable for scaled/production environments. Use Redis/DB.
email_send_status = {}
status_lock = threading.Lock()

# --- Helper Functions ---

def is_valid_email(email):
    """Basic email format validation."""
    if not email or not isinstance(email, str):
        return False
    # Simplified regex, adjust if stricter validation needed
    pattern = r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
    return re.match(pattern, email) is not None

def process_uploaded_files(files):
    """Prepares uploaded files for the SMTP2GO API payload."""
    attachment_payload = []
    if not files:
        return attachment_payload

    processed_count = 0
    for file_storage in files:
        if hasattr(file_storage, 'filename') and file_storage.filename:
            filename = file_storage.filename
            try:
                file_content = file_storage.read()
                if not file_content:
                    logger.warning(f"Skipping empty attachment: {filename}")
                    continue

                encoded_content = base64.b64encode(file_content).decode('utf-8')
                mime_type = file_storage.mimetype or 'application/octet-stream'

                # SMTP2GO expects fields: filename, fileblob (base64), mimetype
                attachment_payload.append({
                    "filename": filename,
                    "fileblob": encoded_content,
                    "mimetype": mime_type
                })
                processed_count += 1
            except Exception as e:
                logger.error(f"Error processing attachment {filename}: {e}", exc_info=True)
        else:
            logger.warning(f"Skipping invalid file input item: {type(file_storage)}")

    if processed_count > 0:
        logger.info(f"Processed {processed_count} attachments successfully.")
    return attachment_payload

def normalize_column_name(col_name):
    """Converts column names to safe template variable names."""
    if not isinstance(col_name, str):
        col_name = str(col_name)
    normalized = re.sub(r'\W|^(?=\d)', '_', col_name.strip())
    normalized = normalized.strip('_')
    if not normalized:
        fallback = f"column_{uuid.uuid4().hex[:6]}" # Shorter fallback
        logger.warning(f"Column name '{col_name}' normalized empty, using fallback: {fallback}")
        return fallback
    return normalized

def process_template(template_string, context_data):
    """Replaces {{Variable_Name}} placeholders using context data."""
    if not isinstance(template_string, str):
        return "" # Or return template_string? Empty seems safer.
    if not isinstance(context_data, dict):
        logger.warning("Invalid context data provided for template processing.")
        return template_string # Return original if context is bad

    pattern = r'{{\s*([\w\s.-]+?)\s*}}' # Find {{ Var Name }}

    def replace_match(match):
        template_var = match.group(1).strip()
        normalized_lookup_key = normalize_column_name(template_var)
        # Use .get() for safer dictionary access, return original placeholder if key missing
        value = context_data.get(normalized_lookup_key)
        if value is not None:
            return str(value) # Ensure value is a string
        else:
            # Log missing variable only once per job? (Handled in thread)
            return match.group(0) # Return original {{Placeholder}}

    try:
        processed = re.sub(pattern, replace_match, template_string)
        return processed
    except Exception as e:
        logger.error(f"Error during template processing: {e}", exc_info=True)
        return template_string # Return original template on error

def handle_api_error(response):
    """Parses SMTP2GO (or generic) error response for logging/user feedback."""
    status_code = response.status_code
    error_message = f"API Error ({status_code})"
    parsed = None
    try:
        parsed = response.json()
        # Try common fields first
        if isinstance(parsed, dict):
            if 'error' in parsed:
                # error may be a string or object
                err_val = parsed.get('error')
                if isinstance(err_val, dict):
                    msg = err_val.get('message') or err_val.get('description') or str(err_val)
                else:
                    msg = str(err_val)
                error_message += f": {msg}"
            elif 'data' in parsed and isinstance(parsed['data'], dict):
                # SMTP2GO sometimes returns errors list inside data
                errs = parsed['data'].get('errors') or parsed['data'].get('error')
                if errs:
                    if isinstance(errs, list):
                        msg = "; ".join(str(e) for e in errs[:5])
                    else:
                        msg = str(errs)
                    error_message += f": {msg}"
            elif 'message' in parsed:
                error_message += f": {parsed.get('message')}"
        else:
            error_message += f". Response: {response.text[:200]}"
    except json.JSONDecodeError:
        error_message += f". Response: {response.text[:200]}"
    return error_message, parsed or {}

# --- Flask Routes ---

@app.route('/')
def index():
    """Serves the main application page."""
    return render_template('index.html')

@app.route('/api/send-email', methods=['POST'])
def send_email_route():
    """API endpoint for sending a single email."""
    if not all([SMTP2GO_API_KEY, SMTP2GO_SEND_ENDPOINT, DEFAULT_SENDER_EMAIL]):
         logger.error("Single send failed: Server missing critical configuration.")
         return jsonify({'success': False, 'error': 'Server configuration error.'}), 500

    try:
        data = request.form
        files = request.files.getlist("attachments")

        # Input validation
        to_email = data.get('to_email','').strip()
        subject = data.get('subject','').strip()
        html_content = data.get('html_content','').strip()

        if not (to_email and subject and html_content):
            return jsonify({'success': False, 'error': 'Missing required fields (To, Subject, Content).'}), 400
        if not is_valid_email(to_email):
            return jsonify({'success': False, 'error': f"Invalid 'To Email' format: {to_email}"}), 400

        # Determine sender info
        from_email = data.get('from_email', '').strip() or DEFAULT_SENDER_EMAIL
        from_name = data.get('from_name', '').strip() or DEFAULT_SENDER_NAME
        if from_email != DEFAULT_SENDER_EMAIL and not is_valid_email(from_email):
            logger.warning(f"Invalid 'From Email' ('{data.get('from_email')}'), using default.")
            from_email = DEFAULT_SENDER_EMAIL
            from_name = DEFAULT_SENDER_NAME # Reset name if email is bad

        # Build payload (SMTP2GO)
        to_name = data.get('to_name', '').strip()
        to_value = f"{to_name} <{to_email}>" if to_name else to_email
        sender_value = f"{from_name} <{from_email}>" if from_name else from_email
        payload = {
            "api_key": SMTP2GO_API_KEY,
            "to": [to_value],
            "sender": sender_value,
            "subject": subject,
            "html_body": html_content
        }

        # Add optional CC/BCC after validation
        cc_list = [e.strip() for e in data.get('cc', '').split(',') if is_valid_email(e.strip())]
        if cc_list:
            payload['cc'] = cc_list
        bcc_list = [e.strip() for e in data.get('bcc', '').split(',') if is_valid_email(e.strip())]
        if bcc_list:
            payload['bcc'] = bcc_list

        # Process attachments
        attachments = process_uploaded_files(files)
        if attachments:
            payload["attachments"] = attachments

        # Prepare and send request
        headers = BASE_HEADERS.copy()
        logger.info(f"Sending single email via SMTP2GO: To={to_email}, Subject='{subject[:50]}...'")

        response = requests.post(SMTP2GO_SEND_ENDPOINT, json=payload, headers=headers, timeout=30)
        response.raise_for_status() # Raise HTTPError for 4xx/5xx

        response_data = response.json()
        logger.info(f"Single email success. SMTP2GO Response: {response_data.get('message', 'OK')}")
        return jsonify({'success': True, 'message': 'Email sent successfully.', 'status_code': response.status_code, 'response': response_data})

    except requests.exceptions.HTTPError as http_err:
        error_message, response_data = handle_api_error(http_err.response)
        logger.error(f"Failed single send to {to_email}. {error_message}", exc_info=False)
        return jsonify({'success': False, 'status_code': http_err.response.status_code, 'error': error_message, 'response': response_data}), http_err.response.status_code
    except requests.exceptions.RequestException as req_err:
        logger.error(f"Network error sending single email: {req_err}", exc_info=True)
        return jsonify({'success': False, 'error': "Network error sending email."}), 503
    except Exception as e:
        logger.error(f"Unexpected error in send_email_route: {e}", exc_info=True)
        return jsonify({'success': False, 'error': "Internal server error."}), 500

@app.route('/api/upload-recipients', methods=['POST'])
def upload_recipients_route():
    """API endpoint for uploading and processing recipient files."""
    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'error': 'No file part in request.'}), 400
        file = request.files['file']
        if not file or not file.filename:
            return jsonify({'success': False, 'error': 'No file selected.'}), 400

        filename = file.filename
        file_ext = os.path.splitext(filename)[1].lower()
        logger.info(f"Processing recipient file upload: {filename} ({file_ext})")

        if file_ext not in ['.xlsx', '.xls', '.txt']:
            return jsonify({'success': False, 'error': 'Invalid file type (must be .xlsx, .xls, .txt).'}), 400

        file_content_bytes = file.read()
        if not file_content_bytes:
            return jsonify({'success': False, 'error': 'Uploaded file is empty.'}), 400

        recipients = []
        columns = ['Email'] # Base column required
        invalid_email_count = 0

        # Process based on file type
        if file_ext in ['.xlsx', '.xls']:
            try:
                df = pd.read_excel(BytesIO(file_content_bytes), engine='openpyxl' if file_ext == '.xlsx' else 'xlrd', dtype=str).fillna('')
                if df.empty: return jsonify({'success': False, 'error': 'Excel file has no data rows.'}), 400

                email_col = next((c for c in df.columns if str(c).strip().lower() == 'email'), None)
                if not email_col: return jsonify({'success': False, 'error': 'Excel file must contain an "Email" column.'}), 400

                raw_cols = df.columns.tolist()
                norm_map = {c: normalize_column_name(c) for c in raw_cols}

                for _, row in df.iterrows():
                    email = str(row[email_col]).strip()
                    if not is_valid_email(email): invalid_email_count += 1; continue
                    if len(recipients) >= MAX_RECIPIENTS:
                         logger.warning(f"Recipient limit ({MAX_RECIPIENTS}) hit processing {filename}.")
                         return jsonify({'success': False, 'error': f'Limit of {MAX_RECIPIENTS} recipients exceeded.'}), 413 # Payload Too Large

                    rcpt = {'Email': email}
                    for raw, norm in norm_map.items():
                        if raw != email_col: rcpt[norm] = str(row[raw]).strip()
                    recipients.append(rcpt)

                columns = ['Email'] + sorted(list(set(norm for raw, norm in norm_map.items() if raw != email_col)))

            except Exception as e:
                logger.error(f"Excel processing error for {filename}: {e}", exc_info=True)
                return jsonify({'success': False, 'error': 'Error processing Excel file. Check format.'}), 400

        elif file_ext == '.txt':
            try:
                lines = file_content_bytes.decode('utf-8', errors='ignore').splitlines()
                for i, line in enumerate(lines):
                    email = line.strip()
                    if not email: continue
                    if not is_valid_email(email): invalid_email_count += 1; continue
                    if len(recipients) >= MAX_RECIPIENTS:
                        logger.warning(f"Recipient limit ({MAX_RECIPIENTS}) hit processing {filename}.")
                        return jsonify({'success': False, 'error': f'Limit of {MAX_RECIPIENTS} recipients exceeded.'}), 413
                    recipients.append({'Email': email})
            except Exception as e:
                logger.error(f"Text file processing error for {filename}: {e}", exc_info=True)
                return jsonify({'success': False, 'error': 'Error processing text file.'}), 400

        # Final checks and response
        if invalid_email_count > 0:
            logger.warning(f"Skipped {invalid_email_count} invalid email addresses in {filename}.")
        count = len(recipients)
        if count == 0:
            logger.warning(f"No valid recipients found in {filename}.")
            return jsonify({'success': False, 'error': 'No valid email addresses found in the file.'}), 400

        logger.info(f"Successfully processed {filename}. Found {count} recipients. Columns: {columns}")
        return jsonify({
            'success': True, 'count': count, 'recipients': recipients,
            'columns': columns, 'file_type': 'excel' if file_ext in ['.xlsx', '.xls'] else 'text'
        })

    except Exception as e:
        logger.error(f"Unexpected error during recipient upload: {e}", exc_info=True)
        return jsonify({'success': False, 'error': "Internal server error during upload."}), 500

@app.route('/api/send-bulk', methods=['POST'])
def send_bulk_route():
    """API endpoint to initiate a bulk email sending campaign."""
    if not all([SMTP2GO_API_KEY, SMTP2GO_SEND_ENDPOINT, DEFAULT_SENDER_EMAIL]):
        return jsonify({'success': False, 'error': 'Server configuration error.'}), 500

    try:
        data = request.form
        files = request.files.getlist("attachments") # Common attachments

        # Validate required form fields
        recipients_str = data.get('recipients')
        subject_tmpl = data.get('subject')
        html_tmpl = data.get('html_content')
        interval_str = data.get('interval', str(DEFAULT_INTERVAL))
        from_email_tmpl = data.get('from_email_template', '').strip()
        from_name_tmpl = data.get('from_name_template', '').strip()

        required = {'Recipients data': recipients_str, 'Subject template': subject_tmpl, 'Content template': html_tmpl}
        missing = [name for name, value in required.items() if not value]
        if missing:
            return jsonify({'success': False, 'error': f"Missing required fields: {', '.join(missing)}."}), 400

        # Validate recipients JSON and count
        try:
            recipients = json.loads(recipients_str)
            if not isinstance(recipients, list): raise ValueError("Invalid format")
            recipient_count = len(recipients)
            if recipient_count == 0: raise ValueError("Empty list")
            if recipient_count > MAX_RECIPIENTS:
                raise ValueError(f"Recipient count ({recipient_count}) exceeds limit ({MAX_RECIPIENTS}).")
        except (json.JSONDecodeError, ValueError) as e:
            logger.error(f"Invalid recipients data received: {e}")
            return jsonify({'success': False, 'error': f'Invalid recipients data: {e}'}), 400

        # Validate interval
        try:
            interval = int(interval_str)
            if not (MIN_INTERVAL <= interval <= MAX_INTERVAL):
                raise ValueError(f"Interval must be between {MIN_INTERVAL} and {MAX_INTERVAL}.")
        except (ValueError) as e:
            logger.warning(f"Invalid interval value '{interval_str}': {e}")
            return jsonify({'success': False, 'error': str(e)}), 400

        # Process common attachments
        common_attachments = process_uploaded_files(files)

        # Generate Job ID and Initial Status
        job_id = f"bulk-{uuid.uuid4()}"
        start_time = time.time()
        initial_status = {
            'job_id': job_id, 'total': recipient_count, 'processed': 0,
            'success': 0, 'failed': 0, 'in_progress': True, 'start_time': start_time,
            'end_time': None, 'duration': None, 'failed_emails': [],
            'completion_percentage': 0, 'current_recipient': 'Initializing...', 'error': None
        }
        with status_lock:
            email_send_status[job_id] = initial_status

        # Start Background Thread
        thread_args = (job_id, recipients, subject_tmpl, html_tmpl, interval, common_attachments, from_email_tmpl, from_name_tmpl)
        thread = threading.Thread(target=send_personalized_emails_thread, args=thread_args, name=f"BulkSend-{job_id}", daemon=True)
        thread.start()

        estimated_secs = recipient_count * interval
        logger.info(f"Bulk job {job_id} initiated ({recipient_count} emails, interval {interval}s). Estimated: ~{estimated_secs}s.")
        return jsonify({
            'success': True, 'message': f'Bulk campaign initiated ({recipient_count} emails).', 'job_id': job_id,
            'details': {'total_emails': recipient_count, 'interval': f"{interval}s", 'estimated_completion_secs': estimated_secs}
        })

    except ValueError as ve: # Catch specific validation errors (count, interval)
        logger.warning(f"Bulk send initiation failed: {ve}")
        return jsonify({'success': False, 'error': str(ve)}), 400 # Or 413 if limit exceeded
    except Exception as e:
        logger.error(f"Unexpected error initiating bulk send: {e}", exc_info=True)
        # Attempt cleanup only if job_id might have been assigned
        job_id_local = locals().get('job_id')
        if job_id_local:
            with status_lock: email_send_status.pop(job_id_local, None) # Safely remove if exists
        return jsonify({'success': False, 'error': "Internal server error initiating campaign."}), 500


def send_personalized_emails_thread(job_id, recipients, subject_tmpl, html_tmpl, interval, common_attachments, from_email_tmpl, from_name_tmpl):
    """Background worker thread for sending bulk emails."""
    thread_start_time = time.time()
    logger.info(f"[Job {job_id}] Worker thread started.")

    # --- Initial Checks ---
    with status_lock: current_status = email_send_status.get(job_id)
    if not current_status: logger.error(f"[Job {job_id}] CRITICAL: Status object missing at start."); return
    if not all([DEFAULT_SENDER_EMAIL, DEFAULT_SENDER_NAME, SMTP2GO_SEND_ENDPOINT, SMTP2GO_API_KEY]):
        error_msg = "CRITICAL: Background thread missing default sender/API config."
        logger.error(f"[Job {job_id}] {error_msg}")
        with status_lock: s = email_send_status.get(job_id); s.update({'error': error_msg, 'in_progress': False}) if s else None
        return

    total = len(recipients); success_count = 0; failed_count = 0; processed_count = 0
    session = requests.Session(); session.headers.update(BASE_HEADERS)
    missing_vars_log = set() # Log each missing variable only once

    # --- Main Processing Loop ---
    for i, recipient_data in enumerate(recipients):
        processed_count = i + 1
        email_address = None # For logging in case of error before assignment
        attempt_start_time = time.time()

        # --- Check for External Stop Signal ---
        with status_lock:
            job_state = email_send_status.get(job_id)
            if not (job_state and job_state.get('in_progress')):
                logger.info(f"[Job {job_id}] Job no longer marked 'in_progress'. Halting thread.")
                break # Exit loop if job was stopped/completed elsewhere

        try:
            # --- Validate Recipient Data ---
            if not isinstance(recipient_data, dict) or 'Email' not in recipient_data:
                raise ValueError("Invalid recipient data structure.")
            email_address = recipient_data['Email'].strip()
            if not is_valid_email(email_address):
                raise ValueError(f"Invalid recipient email format: '{email_address}'.")

            # --- Update Live Status ---
            with status_lock:
                status = email_send_status.get(job_id)
                if status: # Check again as job might be removed
                    status['processed'] = processed_count
                    status['current_recipient'] = email_address
                    status['completion_percentage'] = int((processed_count / total) * 100) if total > 0 else 0

            # --- Process Templates ---
            context = recipient_data.copy() # Use a copy for processing
            subject = process_template(subject_tmpl, context)
            html_body = process_template(html_tmpl, context)
            recipient_name = str(context.get('Name', context.get('First_Name', ''))).strip() # Common names

            # Check for unprocessed template variables (potential data issue)
            combined_content = subject + html_body # Check both
            if '{{' in combined_content:
                placeholders = re.findall(r'{{\s*([\w\s.-]+?)\s*}}', subject_tmpl + html_tmpl)
                for var_name in placeholders:
                    norm_key = normalize_column_name(var_name)
                    if norm_key not in context and norm_key not in missing_vars_log:
                         logger.warning(f"[Job {job_id}] Template var '{{{{{var_name}}}}}' (Key: {norm_key}) missing for {email_address} (logged once).")
                         missing_vars_log.add(norm_key)

            # --- Determine Sender Information (Dynamic/Fallback) ---
            sender_email = DEFAULT_SENDER_EMAIL
            sender_name = DEFAULT_SENDER_NAME
            sender_source = 'default'
            if from_email_tmpl:
                processed_email = process_template(from_email_tmpl, context).strip()
                # Use dynamic email ONLY if valid and fully processed
                if is_valid_email(processed_email) and '{{' not in processed_email:
                    sender_email = processed_email
                    sender_source = 'template'
                    # Determine name based on dynamic email success
                    if from_name_tmpl:
                        processed_name = process_template(from_name_tmpl, context).strip()
                        sender_name = processed_name if processed_name and '{{' not in processed_name else DEFAULT_SENDER_NAME
                    else: # No name template provided, use default name
                        sender_name = DEFAULT_SENDER_NAME
                elif processed_email != from_email_tmpl or '{{' in processed_email: # Log if processing failed
                    logger.debug(f"[Job {job_id}] Sender email template failed for {email_address} ('{processed_email}'), using default.")

            # --- Construct API Payload ---
            sender_value = f"{sender_name} <{sender_email}>" if sender_name else sender_email
            to_value = f"{recipient_name} <{email_address}>" if recipient_name else email_address
            payload = {
                "api_key": SMTP2GO_API_KEY,
                "to": [to_value],
                "sender": sender_value,
                "subject": subject,
                "html_body": html_body
            }
            if common_attachments:
                payload["attachments"] = common_attachments

            # --- Send via API ---
            logger.debug(f"[Job {job_id}] Sending {processed_count}/{total} to {email_address} via {sender_source} sender.")
            response = session.post(SMTP2GO_SEND_ENDPOINT, json=payload, timeout=30)
            response.raise_for_status() # Raise error for bad status codes

            success_count += 1
            logger.debug(f"[Job {job_id}] OK {processed_count}/{total} for {email_address}")

        # --- Handle Exceptions for This Recipient ---
        except (ValueError) as validation_err: # Data/format errors
            failed_count += 1
            error_msg = f"Data Validation Error: {validation_err}"
            logger.error(f"[Job {job_id}] Failed {processed_count}/{total} ({email_address or 'Invalid Data'}). {error_msg}")
            with status_lock: s=email_send_status.get(job_id); s['failed_emails'].append({'email': email_address or f"Row {i+1}", 'error': error_msg}) if s else None
        except requests.exceptions.HTTPError as http_err:
            failed_count += 1
            error_message, _ = handle_api_error(http_err.response) # Use helper
            logger.warning(f"[Job {job_id}] Failed {processed_count}/{total} to {email_address}. {error_message}")
            with status_lock: s=email_send_status.get(job_id); s['failed_emails'].append({'email': email_address, 'error': error_message}) if s else None
        except requests.exceptions.RequestException as req_err:
            failed_count += 1
            error_msg = f"Network Error: {req_err}"
            logger.error(f"[Job {job_id}] Network error sending {processed_count}/{total}: {req_err}")
            with status_lock: s=email_send_status.get(job_id); s['failed_emails'].append({'email': email_address, 'error': "Network error"}) if s else None
            # Consider pausing or stopping thread on repeated network errors?
        except Exception as e:
            failed_count += 1
            error_msg = f"Unexpected Processing Error: {e}"
            logger.error(f"[Job {job_id}] Unexpected error for {processed_count}/{total} ({email or 'Unknown'}): {e}", exc_info=True)
            with status_lock: s=email_send_status.get(job_id); s['failed_emails'].append({'email': email_address or f"Row {i+1}", 'error': "Internal processing error"}) if s else None
        finally:
            # --- Update Counts After Each Attempt ---
            with status_lock:
                status = email_send_status.get(job_id)
                if status:
                    status['success'] = success_count
                    status['failed'] = failed_count

            # --- Interval Delay Logic ---
            if i < total - 1: # Only sleep if not the last item
                elapsed = time.time() - attempt_start_time
                sleep_needed = max(0.01, interval - elapsed) # Ensure minimum pause
                time.sleep(sleep_needed) # Python's time.sleep handles the timing

    # --- Final Job Update ---
    thread_end_time = time.time()
    final_duration = round(thread_end_time - thread_start_time, 2)
    logger.info(f"[Job {job_id}] Worker thread finished. Processed: {processed_count}, Success: {success_count}, Failed: {failed_count}. Duration: {final_duration}s.")
    with status_lock:
        final_status = email_send_status.get(job_id)
        if final_status:
            final_status.update({
                'in_progress': False, 'end_time': thread_end_time, 'duration': final_duration,
                'current_recipient': 'Completed', 'processed': processed_count, # Ensure final counts are set
                'success': success_count, 'failed': failed_count, 'completion_percentage': 100
            })
            logger.info(f"[Job {job_id}] Final job status updated in memory.")
        else:
            logger.warning(f"[Job {job_id}] Status object was missing at thread completion.")

@app.route('/api/bulk-status/<job_id>', methods=['GET'])
def check_bulk_status_route(job_id):
    """API endpoint to retrieve the status of a bulk send job."""
    with status_lock:
        status_data = email_send_status.get(job_id) # Get status safely

    if not status_data:
        return jsonify({'success': False, 'error': 'Job not found or expired.'}), 404

    # Return a copy to prevent accidental modification via reference
    status_copy = status_data.copy()
    logger.debug(f"Providing status for {job_id}: Processed={status_copy.get('processed')}")
    return jsonify({'success': True, 'status': status_copy})

# --- Main Execution ---
if __name__ == '__main__':
    if missing_configs:
        print(f"\n *** WARNING: Application starting with missing ENV VARS: {', '.join(missing_configs)} ***\n")
    debug_mode = os.getenv('FLASK_DEBUG', 'False').lower() in ('true', '1', 't')
    logger.info(f"Starting SMTP2GO Sender Pro Application (Debug Mode: {debug_mode})")
    # Note: use_reloader=True (implicit with debug=True) can cause issues with background threads
    # starting twice in some scenarios. Be mindful if adding more complex threading.
    app.run(debug=debug_mode, host='0.0.0.0', port=5000, use_reloader=debug_mode)
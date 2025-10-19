// static/app.js - SMTP2GO Sender Pro Frontend Logic
document.addEventListener('DOMContentLoaded', function() {
    // --- Globals ---
    let uploadedRecipients = [];
    let availableVariables = [];
    let bulkSendJobId = null;
    let statusPollInterval = null;
    const MAX_DISPLAY_FAILED_EMAILS = 100;

    // --- Element Cache ---
    const elements = {
        singleTab: document.getElementById('single-tab'),
        bulkTab: document.getElementById('bulk-tab'),
        singlePanel: document.getElementById('single-email-panel'), // CORRECT: Cache the panel
        bulkPanel: document.getElementById('bulk-email-panel'),     // CORRECT: Cache the panel
        singleForm: document.getElementById('single-email-form'),   // Keep for form operations if needed
        bulkForm: document.getElementById('bulk-email-form'),       // Keep for form operations if needed
        singleToEmailInput: document.getElementById('to-email'),
        singleSubjectInput: document.getElementById('subject'),
        singleContentInput: document.getElementById('content'),
        singleFromEmailInput: document.getElementById('from-email'),
        singleFromNameInput: document.getElementById('from-name'),
        sendSingleEmailButton: document.getElementById('send-single-email'),
        singleAttachmentsInput: document.getElementById('single-attachments'),
        fileUploadArea: document.getElementById('file-upload-label'),
        fileUploadInput: document.getElementById('file-upload'),
        fileInfoDiv: document.getElementById('file-info'),
        fileNameSpan: document.getElementById('file-name'),
        recipientCountSpan: document.getElementById('recipient-count'),
        columnsInfoDiv: document.getElementById('columns-info'),
        availableColumnsSpan: document.getElementById('available-columns'),
        clearFileButton: document.getElementById('clear-file'),
        bulkSubjectInput: document.getElementById('bulk-subject'),
        bulkContentInput: document.getElementById('bulk-content'),
        bulkFromEmailInput: document.getElementById('bulk-from-email'),
        bulkFromNameInput: document.getElementById('bulk-from-name'),
        bulkAttachmentsInput: document.getElementById('bulk-attachments'),
        intervalSlider: document.getElementById('interval'),
        intervalValueSpan: document.getElementById('interval-value'),
        sendBulkEmailButton: document.getElementById('send-bulk-email'),
        progressSection: document.getElementById('progress-section'),
        progressBar: document.getElementById('progress-bar'),
        progressText: document.getElementById('progress-text'),
        progressCount: document.getElementById('progress-count'),
        currentRecipientSpan: document.getElementById('current-recipient'),
        sendingIndicator: document.getElementById('sending-indicator'),
        statTotal: document.getElementById('stat-total'),
        statSuccess: document.getElementById('stat-success'),
        statFailed: document.getElementById('stat-failed'),
        completionTimeSpan: document.getElementById('completion-time'),
        failedEmailsSection: document.getElementById('failed-emails-section'),
        toggleFailedListButton: document.getElementById('toggle-failed-list'),
        failedCountDisplay: document.getElementById('failed-count-display'),
        failedEmailsList: document.getElementById('failed-emails-list'),
        statusMessageContainer: document.getElementById('status-message-container'),
        currentYearSpan: document.getElementById('current-year')
    };

    // --- Initial Setup ---
    if (!validateElements()) return;
    setupEventListeners();
    switchTab('single');
    createStarBackground();
    updateFooterYear();
    handleIntervalChange();

    // --- Element Validation ---
    function validateElements() {
        const criticalElements = [
            elements.singleTab, elements.bulkTab, elements.singlePanel, elements.bulkPanel, // Check panels
            elements.singleForm, elements.bulkForm, elements.fileUploadInput, elements.sendSingleEmailButton,
            elements.sendBulkEmailButton, elements.progressSection, elements.statusMessageContainer
        ];
        if (criticalElements.some(el => !el)) {
            console.error("CRITICAL ERROR: Essential UI elements are missing. App init failed.");
            document.body.innerHTML = '<div style="color: red; padding: 20px;">Error: Application failed to load components.</div>';
            return false;
        }
        return true;
    }

    // --- Event Listeners Setup ---
    function setupEventListeners() {
        elements.singleTab?.addEventListener('click', () => switchTab('single'));
        elements.bulkTab?.addEventListener('click', () => switchTab('bulk'));
        elements.intervalSlider?.addEventListener('input', handleIntervalChange);
        elements.fileUploadInput?.addEventListener('change', handleFileUpload);
        elements.fileUploadArea?.addEventListener('click', () => elements.fileUploadInput?.click());
        elements.fileUploadArea?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); elements.fileUploadInput?.click(); }
        });
        elements.clearFileButton?.addEventListener('click', resetFileUploadUI);
        elements.sendSingleEmailButton?.addEventListener('click', handleSendSingleEmail);
        elements.sendBulkEmailButton?.addEventListener('click', handleSendBulkEmail);
        elements.toggleFailedListButton?.addEventListener('click', toggleFailedEmailsList);

        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(createStarBackground, 300);
        });
        elements.singleForm?.addEventListener('submit', e => e.preventDefault());
        elements.bulkForm?.addEventListener('submit', e => e.preventDefault());
    }

    // --- Dynamic Content Updates ---
    function updateFooterYear() {
        if (elements.currentYearSpan) {
            elements.currentYearSpan.textContent = new Date().getFullYear();
        }
    }

    // --- Tab Management ---
    function switchTab(tabName) {
        clearAllStatusMessages();
        // Decide whether to stop polling when switching tabs. Generally, allow it to continue.
        // stopPolling();

        const isSingle = tabName === 'single';
        elements.singleTab?.classList.toggle('active', isSingle);
        elements.bulkTab?.classList.toggle('active', !isSingle);
        elements.singleTab?.setAttribute('aria-selected', isSingle);
        elements.bulkTab?.setAttribute('aria-selected', !isSingle);

        // --- CORRECTED VISIBILITY TOGGLE ---
        // Target the PANELS, not the forms
        elements.singlePanel?.classList.toggle('hidden', !isSingle);
        elements.bulkPanel?.classList.toggle('hidden', isSingle);
        // --- END CORRECTION ---


        // Manage progress section visibility
        if (!isSingle && bulkSendJobId) {
            elements.progressSection?.classList.remove('hidden'); // Show if bulk tab & job active
        } else {
            elements.progressSection?.classList.add('hidden'); // Hide otherwise
        }
    }


    // --- Interval Slider ---
    function handleIntervalChange() {
        if (elements.intervalValueSpan && elements.intervalSlider) {
            elements.intervalValueSpan.textContent = `${elements.intervalSlider.value}s`;
        }
    }

    // --- File Upload & Processing ---
    async function handleFileUpload(event) {
        const fileInput = event.target;
        if (!fileInput || fileInput.files.length === 0) return;
        const file = fileInput.files[0];
        if (!file) { showStatusMessage('No file selected.', 'warning'); return; }

        const allowedTypes = ['text/plain', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
        const maxSizeMB = 10;
        if (!allowedTypes.includes(file.type) && !file.name.endsWith('.xls') && !file.name.endsWith('.xlsx') && !file.name.endsWith('.txt')) {
             showStatusMessage(`Invalid file type. Please upload .txt, .xls, or .xlsx.`, 'error');
             resetFileUploadUI(); return;
        }
        if (file.size > maxSizeMB * 1024 * 1024) {
             showStatusMessage(`File size exceeds ${maxSizeMB}MB limit.`, 'error');
             resetFileUploadUI(); return;
        }

        const formData = new FormData();
        formData.append('file', file);

        resetFileUploadUI(false);
        setBulkSendButtonState(true, 'Processing file...');
        elements.fileInfoDiv?.classList.remove('hidden', 'border-red-500');
        elements.fileNameSpan.textContent = `Processing ${file.name}...`;
        elements.recipientCountSpan.textContent = '-';
        clearAllStatusMessages();

        try {
            const response = await fetch('/api/upload-recipients', { method: 'POST', body: formData });
            const data = await response.json();

            if (response.ok && data.success) {
                elements.fileNameSpan.textContent = file.name;
                elements.recipientCountSpan.textContent = data.count;
                uploadedRecipients = data.recipients || [];
                availableVariables = data.columns || ['Email'];

                if (availableVariables.length > 0) { // Show even if only Email
                    elements.availableColumnsSpan.innerHTML = availableVariables
                        .map(col => `<span class="variable-highlight">{{${col}}}</span>`)
                        .join(' ');
                    elements.columnsInfoDiv?.classList.remove('hidden');
                    if (availableVariables.length > 1) autoSuggestTemplate(data); // Suggest only if more than email
                } else {
                     elements.columnsInfoDiv?.classList.add('hidden');
                }

                if (data.count > 0) {
                    showStatusMessage(`File processed: ${data.count} valid recipient(s) found.`, 'success');
                    setBulkSendButtonState(false);
                } else {
                    showStatusMessage('File processed, but no valid recipients found.', 'warning');
                    resetFileUploadUI(); // Reset fully if count is 0
                }
            } else {
                 showStatusMessage(data.error || `Failed to process file (HTTP ${response.status})`, 'error');
                 resetFileUploadUI();
                 elements.fileInfoDiv?.classList.add('border border-red-500');
            }
        } catch (error) {
            console.error('File upload network/fetch error:', error);
            showStatusMessage('An unexpected network error occurred during upload.', 'error');
            resetFileUploadUI();
            elements.fileInfoDiv?.classList.add('border border-red-500');
        }
    }

    function resetFileUploadUI(clearInput = true) {
         if (clearInput && elements.fileUploadInput) elements.fileUploadInput.value = '';
         elements.fileNameSpan.textContent = '';
         elements.recipientCountSpan.textContent = '0';
         elements.fileInfoDiv?.classList.add('hidden');
         elements.fileInfoDiv?.classList.remove('border', 'border-red-500');
         elements.columnsInfoDiv?.classList.add('hidden');
         elements.availableColumnsSpan.innerHTML = ''; // Use innerHTML since we add spans
         setBulkSendButtonState(true);
         uploadedRecipients = [];
         availableVariables = [];
         if (elements.bulkAttachmentsInput) elements.bulkAttachmentsInput.value = '';
         console.log("File upload UI reset.");
    }

    function setBulkSendButtonState(isDisabled, text = 'Start Bulk Campaign') { // Updated text
        if (!elements.sendBulkEmailButton) return;
        elements.sendBulkEmailButton.disabled = isDisabled;
        if (!isDisabled) {
             const iconHTML = '<i class="fas fa-paper-plane mr-2"></i>';
             elements.sendBulkEmailButton.innerHTML = `${iconHTML} ${text}`;
        }
    }

    function autoSuggestTemplate(uploadData) {
        const subjectInput = elements.bulkSubjectInput;
        const contentArea = elements.bulkContentInput;
        if (!uploadData.columns || uploadData.columns.length <= 1 || uploadData.file_type !== 'excel' || !subjectInput || !contentArea || subjectInput.value || contentArea.value) {
             return;
        }
        const nameVar = uploadData.columns.find(c => c && ['name', 'firstname', 'first_name', 'fname'].includes(c.toLowerCase()));
        if (nameVar) {
            subjectInput.value = `Regarding Your Account`; // More generic default
            contentArea.value = `<p>Dear {{${nameVar}}},</p>\n\n<p>We have an update for you regarding [Your Topic Here].</p>\n\n<p>...</p>\n\n<p>Sincerely,<br>\nThe Team</p>`;
            showStatusMessage("Suggested subject and content based on uploaded columns.", "info", 3500);
        }
    }

    // --- Input Validation Helper ---
    function validateAndReport(inputElement, message) {
        if (!inputElement) return true;
        inputElement.classList.remove('border-red-500');
        let isValid = true;
        if (!inputElement.value.trim()) {
            isValid = false;
            message = inputElement.validationMessage || message; // Use browser message if available
        } else if (inputElement.type === 'email' && !isValidEmail(inputElement.value)) {
            isValid = false;
            message = 'Please enter a valid email address.';
        }

        if (!isValid) {
            inputElement.classList.add('border-red-500');
            inputElement.focus();
            showStatusMessage(message, 'error');
            inputElement.reportValidity?.(); // Trigger browser validation bubble
            return false;
        }
        return true;
    }

    function isValidEmail(email) {
        const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        return emailRegex.test(email);
    }

    // --- Single Email Send ---
    async function handleSendSingleEmail() {
        clearAllStatusMessages();
        let isValid = true;
        isValid = validateAndReport(elements.singleToEmailInput, 'Recipient Email is required.') && isValid;
        isValid = validateAndReport(elements.singleSubjectInput, 'Subject is required.') && isValid;
        isValid = validateAndReport(elements.singleContentInput, 'Email Content is required.') && isValid;

        const fromEmail = elements.singleFromEmailInput?.value.trim();
        if (fromEmail && !isValidEmail(fromEmail)) {
             elements.singleFromEmailInput.classList.add('border-red-500');
             elements.singleFromEmailInput.focus();
             showStatusMessage('The provided "From Email" appears invalid.', 'error');
             isValid = false;
        } else if (elements.singleFromEmailInput) {
             elements.singleFromEmailInput.classList.remove('border-red-500');
        }
        if (!isValid) return;

        setButtonLoading(elements.sendSingleEmailButton, true, 'Sending...');
        const formData = new FormData(elements.singleForm);

        try {
            const response = await fetch('/api/send-email', { method: 'POST', body: formData });
            const data = await response.json();
            if (response.ok && data.success) {
                showStatusMessage(data.message || 'Email sent successfully!', 'success');
                // Preserve form inputs and attachments after send; do not reset here.
            } else {
                showStatusMessage(`Failed to send email: ${data.error || `Server error (${response.status})`}`, 'error');
                console.error("Single Send Error Details:", data.response || data);
            }
        } catch (error) {
            console.error('Single send network/fetch error:', error);
            showStatusMessage('A network error occurred. Please check connection.', 'error');
        } finally {
            setButtonLoading(elements.sendSingleEmailButton, false, 'Send Email');
        }
    }

    // --- Bulk Email Send ---
    async function handleSendBulkEmail() {
        clearAllStatusMessages();
        let isValid = true;
        if (uploadedRecipients.length === 0) {
            showStatusMessage('Please upload a recipient list file first.', 'error');
            elements.fileUploadArea?.focus(); isValid = false;
        }
        isValid = validateAndReport(elements.bulkSubjectInput, 'Subject is required.') && isValid;
        isValid = validateAndReport(elements.bulkContentInput, 'Email Content is required.') && isValid;
        if (!isValid) return;

        setButtonLoading(elements.sendBulkEmailButton, true, 'Initiating...');
        elements.progressSection?.classList.remove('hidden');
        resetProgressUI(uploadedRecipients.length);

        const formData = new FormData();
        formData.append('recipients', JSON.stringify(uploadedRecipients));
        formData.append('subject', elements.bulkSubjectInput.value.trim());
        formData.append('html_content', elements.bulkContentInput.value.trim());
        formData.append('interval', elements.intervalSlider?.value || '4');
        formData.append('from_email_template', elements.bulkFromEmailInput?.value.trim() || '');
        formData.append('from_name_template', elements.bulkFromNameInput?.value.trim() || '');

        const files = elements.bulkAttachmentsInput?.files;
        if (files) { for (let i = 0; i < files.length; i++) formData.append('attachments', files[i]); }

        try {
            const response = await fetch('/api/send-bulk', { method: 'POST', body: formData });
            const data = await response.json();
            if (response.ok && data.success && data.job_id) {
                bulkSendJobId = data.job_id;
                showStatusMessage(`Bulk campaign ${bulkSendJobId} initiated.`, 'info');
                setButtonLoading(elements.sendBulkEmailButton, true, 'Sending...');
                elements.sendingIndicator?.classList.remove('hidden');
                const interval = parseInt(elements.intervalSlider?.value || '4', 10);
                const totalTimeSeconds = data.details?.total_emails * interval || uploadedRecipients.length * interval;
                const finishTime = new Date(Date.now() + totalTimeSeconds * 1000);
                elements.completionTimeSpan.textContent = `Est. completion: ${formatTime(finishTime)} (~${formatDuration(totalTimeSeconds)})`;
                startPolling(bulkSendJobId);
            } else {
                elements.progressSection?.classList.add('hidden');
                showStatusMessage(`Failed to initiate campaign: ${data.error || `Server error (${response.status})`}`, 'error');
                setButtonLoading(elements.sendBulkEmailButton, false, 'Start Bulk Campaign');
                bulkSendJobId = null;
            }
        } catch (error) {
            console.error('Bulk send initiation network/fetch error:', error);
            elements.progressSection?.classList.add('hidden');
            showStatusMessage('A network error occurred initiating the campaign.', 'error');
            setButtonLoading(elements.sendBulkEmailButton, false, 'Start Bulk Campaign');
            bulkSendJobId = null;
        }
    }

    // --- Progress Polling & UI Update ---
    function resetProgressUI(total) {
        if (!elements.progressSection) return;
        console.log(`Resetting progress UI for ${total} total recipients.`);
        elements.progressBar.style.width = '0%';
        elements.progressBar.className = 'shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-darkaccent transition-all duration-500 ease-in-out'; // Reset classes
        elements.progressBar.setAttribute('aria-valuenow', '0');
        elements.progressText.textContent = '0%';
        elements.progressCount.textContent = `0 / ${total} Processed`;
        elements.currentRecipientSpan.textContent = 'Initializing...';
        elements.sendingIndicator?.classList.add('hidden');
        elements.statTotal.textContent = total;
        elements.statSuccess.textContent = '0';
        elements.statFailed.textContent = '0';
        elements.completionTimeSpan.textContent = 'Calculating estimated time...';
        elements.failedEmailsList.innerHTML = '';
        elements.failedEmailsSection?.classList.add('hidden');
        elements.failedEmailsList?.classList.add('hidden');
        elements.toggleFailedListButton?.querySelector('i')?.classList.remove('rotate-90');
        elements.toggleFailedListButton?.setAttribute('aria-expanded', 'false');
        elements.failedCountDisplay.textContent = '0';
    }

    function startPolling(jobId) {
        stopPolling();
        console.log(`Starting status polling for job: ${jobId}`);
        pollStatus(jobId); // Initial check
        statusPollInterval = setInterval(() => pollStatus(jobId), 2500);
    }

    async function pollStatus(jobId) {
         if (!jobId || jobId !== bulkSendJobId) { stopPolling(); return; }
         console.debug(`Polling status for job ${jobId}...`);
         try {
             const response = await fetch(`/api/bulk-status/${jobId}`);
             if (!response.ok) {
                 console.warn(`Polling check for job ${jobId} returned HTTP ${response.status}.`);
                 if (response.status === 404) {
                    showStatusMessage(`Job ${jobId} not found. Assuming completion.`, 'warning');
                    handleBulkSendCompletion(null); stopPolling();
                 } return;
             }
             const data = await response.json();
             if (data.success && data.status) {
                if (data.status.job_id !== bulkSendJobId) { console.log(`Ignoring status for old job ${data.status.job_id}.`); return; }
                 updateProgressUI(data.status);
                 if (data.status.error) {
                     console.error(`Job ${jobId} failed server-side: ${data.status.error}`);
                     showStatusMessage(`Campaign failed: ${data.status.error}`, 'error');
                     handleBulkSendCompletion(data.status); stopPolling();
                 } else if (!data.status.in_progress) {
                     console.log(`Job ${jobId} completed.`);
                     handleBulkSendCompletion(data.status); stopPolling();
                 }
             } else { console.error('Received invalid status update payload:', data); }
         } catch (error) { console.error('Status polling network/fetch error:', error); }
    }

    function stopPolling() {
        if (statusPollInterval) { clearInterval(statusPollInterval); statusPollInterval = null; console.log("Status polling stopped."); }
    }

    function updateProgressUI(status) {
        if (!elements.progressBar || !status) return;
        const percentage = Math.min(status.completion_percentage || 0, 100);
        const processed = status.processed || 0; // Use 'processed' from backend
        const total = status.total || 0;
        const success = status.success || 0;
        const failed = status.failed || 0;

        elements.progressBar.style.width = `${percentage}%`;
        elements.progressBar.setAttribute('aria-valuenow', percentage);
        elements.progressText.textContent = `${percentage}%`;
        elements.progressCount.textContent = `${processed} / ${total} Processed`;
        elements.currentRecipientSpan.textContent = status.current_recipient || '-';
        elements.statSuccess.textContent = success;
        elements.statFailed.textContent = failed;
        elements.failedCountDisplay.textContent = failed;

        if (failed > 0 && status.failed_emails?.length > 0) {
            elements.failedEmailsSection?.classList.remove('hidden');
            renderFailedEmails(status.failed_emails);
        } else {
            elements.failedEmailsSection?.classList.add('hidden');
            elements.failedEmailsList.innerHTML = '';
        }
        elements.sendingIndicator?.classList.toggle('hidden', !status.in_progress);
    }

    function renderFailedEmails(failedItems) {
        if (!elements.failedEmailsList) return;
        const displayLimit = MAX_DISPLAY_FAILED_EMAILS;
        const itemsToDisplay = failedItems.slice(0, displayLimit);

        const currentRenderedCount = elements.failedEmailsList.children.length;
        // Crude check: only re-render if count changed OR if we previously truncated
        const wasTruncated = currentRenderedCount > 0 && elements.failedEmailsList.lastElementChild?.tagName === 'LI' && elements.failedEmailsList.lastElementChild.textContent.includes('more failures');
        if (currentRenderedCount === itemsToDisplay.length && !wasTruncated) { return; } // Avoid unnecessary DOM manipulation

        console.log(`Rendering ${itemsToDisplay.length} failed emails (limit ${displayLimit})`);
        elements.failedEmailsList.innerHTML = ''; // Clear and rebuild
        itemsToDisplay.forEach(fail => {
            const li = document.createElement('li');
            const emailSpan = document.createElement('span'); emailSpan.className = 'failed-email';
            emailSpan.textContent = fail.email || 'N/A';
            const errorSpan = document.createElement('span'); errorSpan.className = 'failed-error';
            const errorText = fail.error || 'Unknown error';
            errorSpan.textContent = `: ${errorText.length > 150 ? errorText.substring(0, 147) + '...' : errorText}`;
            li.appendChild(emailSpan); li.appendChild(errorSpan);
            elements.failedEmailsList.appendChild(li);
        });
        if (failedItems.length > displayLimit) {
             const li = document.createElement('li');
             li.className = 'text-xs text-gray-500 italic pt-2';
             li.textContent = `...and ${failedItems.length - displayLimit} more failures.`;
             elements.failedEmailsList.appendChild(li);
        }
    }

     function handleBulkSendCompletion(status) {
         const finalStatus = status;
         const jobId = finalStatus?.job_id || bulkSendJobId;
         stopPolling();
         setButtonLoading(elements.sendBulkEmailButton, false, 'Start Bulk Campaign');
         elements.sendingIndicator?.classList.add('hidden');

         if (finalStatus) {
             updateProgressUI(finalStatus);
             const durationStr = finalStatus.duration ? formatDuration(Math.round(finalStatus.duration)) : 'N/A';
             elements.completionTimeSpan.textContent = `Completed in ${durationStr}`;
             elements.currentRecipientSpan.textContent = 'Finished';
             elements.progressBar.style.width = '100%';
             elements.progressBar.setAttribute('aria-valuenow', '100');
             elements.progressBar.classList.remove('bg-darkaccent', 'bg-yellow-500', 'bg-red-500', 'bg-green-500', 'bg-gray-500');

             let finalMessage = `Bulk campaign ${jobId || ''} finished.`;
             let finalMessageType = 'info'; let finalProgressColor = 'bg-gray-500';
             if (finalStatus.error) { finalMessage = `Campaign failed: ${finalStatus.error}`; finalMessageType = 'error'; finalProgressColor = 'bg-red-500'; }
             else if (finalStatus.failed > 0 && finalStatus.success > 0) { finalMessage = `Finished: ${finalStatus.success} success, ${finalStatus.failed} failed.`; finalMessageType = 'warning'; finalProgressColor = 'bg-yellow-500'; }
             else if (finalStatus.failed > 0) { finalMessage = `Finished with ${finalStatus.failed} failed email(s).`; finalMessageType = 'error'; finalProgressColor = 'bg-red-500'; }
             else if (finalStatus.success > 0) { finalMessage = `Completed successfully! ${finalStatus.success} emails sent.`; finalMessageType = 'success'; finalProgressColor = 'bg-green-500'; }
             else { finalMessage = `Finished. No emails were sent or failed.`; finalMessageType = 'info'; finalProgressColor = 'bg-gray-500'; }

             elements.progressBar.classList.add(finalProgressColor);
             showStatusMessage(finalMessage, finalMessageType);
             if (finalStatus.failed > 0 && elements.failedEmailsSection) elements.failedEmailsSection.classList.remove('hidden');
         } else {
             elements.completionTimeSpan.textContent = "Finished (Final status unavailable)";
             elements.currentRecipientSpan.textContent = 'Finished';
             showStatusMessage(`Campaign ${jobId || 'Unknown'} finished, final status unavailable.`, "warning");
             if (elements.progressBar) {
                  elements.progressBar.style.width = '100%'; elements.progressBar.setAttribute('aria-valuenow', '100');
                  elements.progressBar.classList.remove('bg-darkaccent', 'bg-yellow-500', 'bg-red-500', 'bg-green-500');
                  elements.progressBar.classList.add('bg-gray-500');
             }
         }
         bulkSendJobId = null; // Clear active job ID *after* handling completion
     }

     function toggleFailedEmailsList() {
         if (!elements.failedEmailsList || !elements.toggleFailedListButton) return;
         const isHidden = elements.failedEmailsList.classList.toggle('hidden');
         const icon = elements.toggleFailedListButton.querySelector('i');
         if (icon) icon.classList.toggle('rotate-90', !isHidden);
         elements.toggleFailedListButton.setAttribute('aria-expanded', String(!isHidden));
     }

    // --- Utility Functions ---
    function setButtonLoading(button, isLoading, loadingText = 'Processing...') {
        if (!button) return;
        const originalContent = button.dataset.originalContent || button.innerHTML;
        if (!button.dataset.originalContent) button.dataset.originalContent = originalContent; // Store if first time

        if (isLoading) {
            button.disabled = true;
            button.innerHTML = `<i class="fas fa-spinner fa-spin mr-2" aria-hidden="true"></i> ${loadingText}`;
        } else {
            button.disabled = false;
            button.innerHTML = button.dataset.originalContent; // Restore original
        }
    }

    function formatTime(date) {
        if (!(date instanceof Date) || isNaN(date)) return '';
        try { return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }); }
        catch (e) { console.error("Time format error:", e); return ''; }
    }

    function formatDuration(totalSeconds) {
        if (isNaN(totalSeconds) || totalSeconds < 0) return 'N/A';
        totalSeconds = Math.round(totalSeconds);
        if (totalSeconds < 1) return '< 1 sec'; if (totalSeconds < 60) return `${totalSeconds} sec`;
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        let parts = [];
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (hours === 0 && seconds > 0) parts.push(`${seconds}s`); // Show seconds only if less than an hour
        return parts.join(' ') || '0s';
    }

    // --- Status Messages Display ---
    function showStatusMessage(message, type = 'info', duration = 7000) {
        if (!elements.statusMessageContainer) return;
        console.log(`Status [${type}]: ${message}`);

        const messageDiv = document.createElement('div');
        const messageId = `status-msg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        messageDiv.id = messageId;
        messageDiv.className = `flex items-start p-4 mb-3 rounded-lg border shadow-lg transition-all duration-300 ease-out opacity-0 transform translate-y-2`;
        messageDiv.setAttribute('role', type === 'error' || type === 'warning' ? 'alert' : 'status'); // Use alert for errors/warnings

        let iconClass = ''; let colors = ''; // Use config colors from HTML <script>
        switch (type) {
            case 'success': iconClass = 'fa-check-circle'; colors = 'bg-status_success_bg border-status_success_border text-status_success_text'; break;
            case 'warning': iconClass = 'fa-exclamation-triangle'; colors = 'bg-yellow-800 border-yellow-600 text-yellow-200'; break; // Example override if needed
            case 'error': iconClass = 'fa-times-circle'; colors = 'bg-status_error_bg border-status_error_border text-status_error_text'; break;
            default: iconClass = 'fa-info-circle'; colors = 'bg-status_info_bg border-status_info_border text-status_info_text'; break;
        }
        messageDiv.classList.add(...colors.split(' '));

        const messageText = document.createTextNode(message).textContent; // Sanitize
        messageDiv.innerHTML = `
            <div class="flex-shrink-0 mt-0.5"><i class="fas ${iconClass}" aria-hidden="true"></i></div>
            <div class="ml-3 flex-1 text-sm font-medium break-words">${messageText}</div>
            <div class="ml-auto pl-3 flex-shrink-0">
                <button type="button" class="status-dismiss-button" aria-label="Dismiss notification" aria-controls="${messageId}">
                   <span class="sr-only">Dismiss</span><i class="fas fa-times h-4 w-4" aria-hidden="true"></i>
                </button>
            </div>`;

        const dismissButton = messageDiv.querySelector('button');
        const dismiss = () => {
            if (messageDiv.dataset.timerId) clearTimeout(parseInt(messageDiv.dataset.timerId));
            messageDiv.style.opacity = '0'; messageDiv.style.transform = 'scale(0.95)';
            messageDiv.style.marginBottom = `-${messageDiv.offsetHeight}px`;
             setTimeout(() => messageDiv.remove(), 350);
        };
        dismissButton?.addEventListener('click', dismiss);

        elements.statusMessageContainer.appendChild(messageDiv);
        requestAnimationFrame(() => { messageDiv.style.opacity = '1'; messageDiv.style.transform = 'translateY(0)'; });
        if (duration > 0) messageDiv.dataset.timerId = String(setTimeout(dismiss, duration));
    }

    function clearAllStatusMessages() {
        if (!elements.statusMessageContainer) return;
        elements.statusMessageContainer.querySelectorAll('div[id^="status-msg-"]').forEach(div => {
             if (div.dataset.timerId) clearTimeout(parseInt(div.dataset.timerId)); div.remove(); });
    }

    // --- Star Background Generation ---
    function createStarBackground() {
        const container = document.getElementById('stars-container'); if (!container) return;
        const containerWidth = container.clientWidth; const containerHeight = container.clientHeight;
        const starDensity = 0.00008; const starCount = Math.min(Math.floor(containerWidth * containerHeight * starDensity), 250);
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < starCount; i++) {
            const star = document.createElement('div'); star.classList.add('star');
            const left = Math.random() * containerWidth; const top = Math.random() * containerHeight;
            const size = 1 + Math.random() * 1.5; const delay = Math.random() * 10; const duration = 4 + Math.random() * 6;
            star.style.cssText = `left: ${left.toFixed(2)}px; top: ${top.toFixed(2)}px; width: ${size.toFixed(2)}px; height: ${size.toFixed(2)}px; animation: twinkle ${duration.toFixed(2)}s ease-in-out infinite alternate ${delay.toFixed(2)}s;`;
            fragment.appendChild(star);
        }
        container.innerHTML = ''; container.appendChild(fragment);
    }

}); // End DOMContentLoaded
from app import app as application

# This file provides a WSGI entrypoint for production servers like gunicorn.
# Usage example (development):
#   gunicorn -w 2 -b 0.0.0.0:5000 wsgi:application

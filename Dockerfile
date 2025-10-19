# Multi-stage Dockerfile for production deployment
FROM python:3.11-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# System deps (add build tools only if needed for future packages)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl ca-certificates && rm -rf /var/lib/apt/lists/*

# Install dependencies first for layer caching
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY app.py wsgi.py payload.json ./
COPY templates ./templates
COPY static ./static
COPY .env.example ./

# Non-root runtime user (optional)
RUN useradd -m appuser && chown -R appuser /app
USER appuser

EXPOSE 5000

# Default Gunicorn command (override with docker run if needed)
# --threads chosen moderate; adjust workers via env (WEB_CONCURRENCY)
ENV WEB_CONCURRENCY=2
CMD gunicorn --bind 0.0.0.0:5000 --workers ${WEB_CONCURRENCY} --threads 2 --timeout 120 wsgi:application

import os

# Gunicorn configuration for large file uploads
bind = "0.0.0.0:8000"
workers = 1
worker_class = "uvicorn.workers.UvicornWorker"
timeout = 600  # 10 minutes timeout for large uploads
keepalive = 120
max_requests = 1000
max_requests_jitter = 50

# Increase limits for large file uploads (1.5GB to be safe)
limit_request_line = 0  # No limit on request line
limit_request_fields = 100
limit_request_field_size = 1610612736  # 1.5GB in bytes

# Environment-based configuration
if os.getenv("ENVIRONMENT") == "production":
    workers = 4
    accesslog = "-"
    errorlog = "-"
    loglevel = "info"
else:
    workers = 1
    reload = True
    accesslog = "-"
    errorlog = "-"
    loglevel = "debug"

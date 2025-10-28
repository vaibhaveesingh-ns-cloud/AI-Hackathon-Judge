#!/bin/bash

# Set environment variables for large uploads
export UVICORN_H11_MAX_INCOMPLETE_EVENT_SIZE=1610612736  # 1.5GB
export UVICORN_WS_MAX_SIZE=1610612736  # 1.5GB

# Start gunicorn with uvicorn workers for better handling of large uploads
exec gunicorn app.main:app \
    --config gunicorn_config.py \
    --worker-class uvicorn.workers.UvicornWorker \
    --limit-request-line 0 \
    --limit-request-field_size 1610612736

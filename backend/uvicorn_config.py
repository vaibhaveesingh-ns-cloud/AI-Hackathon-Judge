"""
Uvicorn configuration for handling large file uploads
"""

# Server configuration
host = "0.0.0.0"
port = 8000

# Timeout configuration
timeout_keep_alive = 120

# HTTP configuration
h11_max_incomplete_event_size = 1610612736  # 1.5GB for large uploads
ws_max_size = 1610612736  # 1.5GB for WebSocket messages

# Logging
log_level = "info"
access_log = True

# SSL
ssl_keyfile = None
ssl_certfile = None

# Server header
server_header = False
date_header = True

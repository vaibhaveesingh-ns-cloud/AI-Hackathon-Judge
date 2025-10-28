import os

# Maximum file upload size (default 1GB)
MAX_UPLOAD_SIZE = int(os.getenv("MAX_REQUEST_SIZE", str(1024 * 1024 * 1024)))  # 1GB default

# Maximum request body size
MAX_REQUEST_BODY_SIZE = MAX_UPLOAD_SIZE

# Chunk size for file processing
CHUNK_SIZE = 1024 * 1024  # 1MB chunks

# Video file size limit (for frontend validation)
MAX_VIDEO_SIZE = 1024 * 1024 * 1024  # 1GB

# Audio file size limit
MAX_AUDIO_SIZE = 100 * 1024 * 1024  # 100MB

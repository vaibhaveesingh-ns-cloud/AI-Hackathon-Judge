FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY frontend/package*.json ./
RUN npm install --legacy-peer-deps

# Copy all frontend files
COPY frontend/ ./

# Expose Vite dev server port
EXPOSE 3000

# Run Vite dev server on all interfaces
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3000"]

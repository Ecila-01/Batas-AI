# Use a robust, lightweight Python base image that also has Node installed
FROM nikolaik/python-nodejs:python3.12-nodejs22-slim

# Install system-level dependencies for Tesseract OCR and layout parsing compilers
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    libtesseract-dev \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Set up the internal production workspace path
WORKDIR /app

# 1. Setup and install Python virtual environment dependencies
COPY ai_service/requirements.txt ./ai_service/
RUN pip install --no-cache-dir -r ./ai_service/requirements.txt

# 2. Setup and install Node.js backend dependencies
COPY server/package*.json ./server/
RUN cd server && npm install --production

# Copy the rest of the workspace application files into the container
COPY . .

# Set up environment execution contexts
ENV NODE_ENV=production
ENV HOST=0.0.0.0
EXPOSE 5000

# Tell Render to start your Node.js Express server backend
WORKDIR /app/server
CMD ["node", "server.js"]
# Use the official, highly stable Python image directly
FROM python:3.12-slim

# 1. Install system dependencies (Tesseract OCR, compilers, and curl for Node.js)
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    libtesseract-dev \
    gcc \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 2. Download and install the official Node.js runtime natively
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# 3. Set up the internal production workspace path
WORKDIR /app

# 4. Setup and install Python virtual environment dependencies
COPY ai_service/requirements.txt ./ai_service/
RUN pip install --no-cache-dir -r ./ai_service/requirements.txt

# 5. Setup and install Node.js backend dependencies
COPY server/package*.json ./server/
RUN cd server && npm install --production

# 6. Copy the rest of the workspace application files into the container
COPY . .

# 7. Set up environment execution contexts
ENV NODE_ENV=production
ENV HOST=0.0.0.0
EXPOSE 5000

# 8. Tell Render to start your Node.js Express server backend
CMD python3 /app/ai_service/bulk_ingest.py && cd /app/server && node server.js
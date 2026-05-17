# Node.js-only container for the Express API server
FROM node:22-slim

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm install --production

# Copy server source
COPY . .

ENV NODE_ENV=production
EXPOSE 5000

CMD ["node", "server.js"]
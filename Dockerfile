# Use official Node.js LTS image
FROM node:22-slim

# Set working directory
WORKDIR /app

# Install system dependencies (ffmpeg-static still needs libc support)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first (for better caching)
COPY package*.json ./

# Install dependencies (production only)
RUN npm install --omit=dev

# Copy application source
COPY . .

# Expose app port (change if your app uses a different one)
EXPOSE 6060

# Set environment
ENV NODE_ENV=production

# Start the app
CMD ["node", "src/app.js"]

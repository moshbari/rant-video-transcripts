FROM node:20-alpine

# Install curl (required for GHL API uploads)
RUN apk add --no-cache curl

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install --production

# Copy app files
COPY server.js ./
COPY index.html ./

# Create temp upload directory
RUN mkdir -p /tmp/uploads

EXPOSE 3000

CMD ["node", "server.js"]

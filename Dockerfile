FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build the project
RUN npm run build

# Add example scripts
RUN echo '#!/bin/sh\nexec node dist/examples/basic-usage.js' > /usr/local/bin/example:basic
RUN echo '#!/bin/sh\nexec node dist/examples/multi-instance.js' > /usr/local/bin/example:multi-instance
RUN chmod +x /usr/local/bin/example:*

# Default command
CMD ["node", "dist/examples/basic-usage.js"]

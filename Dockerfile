FROM node:21

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY src ./src
COPY configs ./configs

CMD [ "node", "src/listen.js" ]

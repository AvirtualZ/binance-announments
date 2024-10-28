每秒从币安拿公告，取出永续合约的公告，然后在OKX下多单。

# 1. 安装redis

sudo apt install redis-server

# 2. 安装node

curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.38.0/install.sh | bash

nvm install v20.4.0

npm install -D tsx @types/node

# 3. 安装 pm2

npm install pm2 -g

# 4. 编译

tsc

# 5. 运行

npm run start

或 pm2 start dist/main.js

// PM2 process manager config. On the VPS: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'omegle-web',
      script: 'node_modules/.bin/next',
      args: 'start -H 127.0.0.1 -p 3000',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '300M',
    },
    {
      name: 'omegle-signaling',
      script: 'server.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 3001,
        // Must match your real domain(s), comma-separated if more than one.
        CORS_ORIGIN: 'https://yourdomain.com',
      },
      max_memory_restart: '200M',
    },
  ],
};

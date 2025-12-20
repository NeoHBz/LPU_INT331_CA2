module.exports = {
  apps: [{
    name: 'mock-class-server',
    script: 'bun run dev',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      PORT: 8512,
    }
  }]
};

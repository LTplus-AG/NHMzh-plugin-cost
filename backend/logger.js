const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

class Logger {
  constructor(config = {}) {
    this.level = config.level || process.env.LOG_LEVEL || 'info';
    this.prefix = config.prefix || '[Cost-Backend]';
    this.enableTimestamp = config.enableTimestamp !== false;
  }

  shouldLog(level) {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  formatMessage(level, message, data) {
    const timestamp = this.enableTimestamp ? new Date().toISOString() : '';
    const parts = [
      timestamp,
      this.prefix,
      `[${level.toUpperCase()}]`,
      message
    ].filter(Boolean);
    
    return parts.join(' ');
  }

  debug(message, data) {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message), data || '');
    }
  }

  info(message, data) {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message), data || '');
    }
  }

  warn(message, data) {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message), data || '');
    }
  }

  error(message, error) {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message), error || '');
    }
  }

  setLevel(level) {
    this.level = level;
  }
}

// Create singleton instance
const logger = new Logger();

module.exports = logger; 
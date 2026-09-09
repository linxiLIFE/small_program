class AppError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function assert(condition, code, message, status = 400, details) {
  if (!condition) throw new AppError(code, message, status, details);
}

function publicError(error) {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, details: error.details };
  }
  console.error('未处理的业务异常', error);
  return { code: 'INTERNAL_ERROR', message: '服务暂时繁忙，请稍后重试' };
}

module.exports = { AppError, assert, publicError };

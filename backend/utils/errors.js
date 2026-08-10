class DomainError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

class NotFoundError extends DomainError {}
class ValidationError extends DomainError {}
class UnauthorizedError extends DomainError {}
class ForbiddenError extends DomainError {}

module.exports = {
  DomainError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError
};

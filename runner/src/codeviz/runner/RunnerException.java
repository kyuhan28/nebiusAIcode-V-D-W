package codeviz.runner;

/** An error that is safe to show the user, with an HTTP status and a stable code. */
public final class RunnerException extends Exception {
  final int status;
  final String code;

  RunnerException(int status, String code, String message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

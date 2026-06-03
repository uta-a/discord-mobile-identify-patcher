export function createLogger({ quiet = false } = {}) {
  return {
    info(message) {
      if (!quiet) console.log(message);
    },
    warn(message) {
      console.warn(message);
    },
    error(message) {
      console.error(message);
    }
  };
}

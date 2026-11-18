// The only import of the Workers-only module, so unit tests can replace it with vi.mock.
export { NonRetryableError } from "cloudflare:workflows";

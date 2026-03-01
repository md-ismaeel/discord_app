// Exhaustive HTTP status code map.
// Using `as const` gives literal number types (200, 201 …) instead of `number`,
// which means you can use HTTP_STATUS values as discriminants in switch statements
// and the compiler will narrow correctly.

export const HTTP_STATUS = {
    // 2xx — Success
    OK: 200,
    CREATED: 201,
    ACCEPTED: 202,
    NO_CONTENT: 204,

    // 3xx — Redirection
    MOVED_PERMANENTLY: 301,
    NOT_MODIFIED: 304,

    // 4xx — Client errors
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    PAYMENT_REQUIRED: 402,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    METHOD_NOT_ALLOWED: 405,
    CONFLICT: 409,
    GONE: 410,
    UNPROCESSABLE_ENTITY: 422,
    TOO_MANY_REQUESTS: 429,

    // 5xx — Server errors
    INTERNAL_SERVER_ERROR: 500,
    NOT_IMPLEMENTED: 501,
    BAD_GATEWAY: 502,
    SERVICE_UNAVAILABLE: 503,
    GATEWAY_TIMEOUT: 504,
} as const;

// Derive a union type of all valid status codes: 200 | 201 | 204 | …
export type HttpStatus = (typeof HTTP_STATUS)[keyof typeof HTTP_STATUS];
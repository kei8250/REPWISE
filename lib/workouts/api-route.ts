import { toErrorResponse } from './validation';

export function apiError(error: unknown) {
  console.error(error);
  const response = toErrorResponse(error);
  return Response.json(response.body, { status: response.status });
}

export function jsonCreated<T>(value: T) {
  return Response.json(value, { status: 201 });
}

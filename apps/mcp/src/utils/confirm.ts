export function previewResponse(message: string): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text", text: `PREVIEW\n\n${message}\n\nCall again with confirm: true to execute.` }],
  };
}

export function successResponse(message: string): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text", text: message }],
  };
}

export function errorResponse(message: string): { content: Array<{ type: "text"; text: string }>; isError: true } {
  return {
    content: [{ type: "text", text: `ERROR: ${message}` }],
    isError: true,
  };
}

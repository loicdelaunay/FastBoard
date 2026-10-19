/// <reference types="vite/client" />

declare module 'primevue/toasteventbus' {
  const ToastEventBus: {
    emit(type: string, payload?: unknown): void;
    on(type: string, handler: (payload: unknown) => void): void;
    off(type: string, handler: (payload: unknown) => void): void;
  };
  export default ToastEventBus;
}

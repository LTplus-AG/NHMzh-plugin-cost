import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
    root: Element | null = null;
    rootMargin: string = '';
    thresholds: ReadonlyArray<number> = [];
    constructor() { }
    observe() { }
    disconnect() { }
    unobserve() { }
    takeRecords(): IntersectionObserverEntry[] { return []; }
};

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
    constructor() { }
    observe() { }
    disconnect() { }
    unobserve() { }
};

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(), // deprecated
        removeListener: vi.fn(), // deprecated
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })),
});

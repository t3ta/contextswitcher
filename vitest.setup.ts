import { vi } from 'vitest'

vi.mock('child_process', () => {
  return {
    spawn: vi.fn(() => ({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      stdin: { write: vi.fn() },
      on: vi.fn()
    }))
  }
})

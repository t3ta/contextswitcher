import { vi } from 'vitest'

vi.mock('child_process', () => ({
  spawn: vi.fn((cmd, args, opts) => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    stdin: { write: vi.fn() },
    on: vi.fn()
  }))
}))

import type { ReactNode } from 'react'

type StepState = 'active' | 'done' | 'waiting'

interface LoginStepProps {
  number: number
  title: string
  state: StepState
  children: ReactNode
}

// Sign-in is two ordered steps, so it is set the way a question is set on
// paper: the number in the margin, the work beside it.
export function LoginStep({ number, title, state, children }: LoginStepProps) {
  return (
    <li
      data-state={state}
      className="grid grid-cols-[2.25rem_1fr] items-start gap-x-4 transition-opacity data-[state=waiting]:opacity-40"
    >
      <span className="text-muted-foreground pt-px text-right font-mono text-sm tabular-nums">
        {number}.
      </span>
      <div className="flex flex-col gap-3">
        <h2 className="text-sm leading-none font-medium">{title}</h2>
        {children}
      </div>
    </li>
  )
}

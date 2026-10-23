import { forwardRef } from 'react'
import type { InputHTMLAttributes } from 'react'
import { TextInput } from './TextInput'

type NumberInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  function NumberInput({ className, ...props }, ref) {
    return (
      <TextInput
        {...props}
        ref={ref}
        type="number"
        inputMode="decimal"
        className={`tabular ${className ?? ''}`}
      />
    )
  },
)

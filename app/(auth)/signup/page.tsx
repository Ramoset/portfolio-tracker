'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function SignupPage() {
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
      },
    })

    setMessage(error ? error.message : 'Check your email to confirm')
  }

  return (
    <form onSubmit={onSubmit} className="min-h-screen flex flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-bold">Sign Up</h1>
      <input className="border p-2" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
      <input className="border p-2" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
      {message && <p>{message}</p>}
      <button className="bg-blue-600 text-white px-4 py-2 rounded">Create account</button>
    </form>
  )
}

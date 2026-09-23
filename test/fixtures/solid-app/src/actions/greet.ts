'use server'

// oxlint-disable-next-line typescript/require-await -- server actions are always async by contract
export async function greet(name: string): Promise<string> {
  return `Hello, ${name}!`
}

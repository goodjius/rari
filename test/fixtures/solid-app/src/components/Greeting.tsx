export default function Greeting(props: Readonly<{ name: string }>) {
  return <h1 id="greeting">Hello, {props.name}!</h1>
}

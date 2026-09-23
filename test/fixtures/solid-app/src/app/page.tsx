import AsyncData from '../components/AsyncData'
import Counter from '../components/Counter'
import Greeting from '../components/Greeting'

export default function Page() {
  return (
    <div id="page">
      <p>server-only content</p>
      <Greeting name="World" />
      <Counter label="clicks" />
      <AsyncData />
    </div>
  )
}

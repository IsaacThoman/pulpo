import { useId, useState, type CSSProperties } from 'react'
import { randomFaces, type CoinFace } from './coin-flip'
import './coin-flip.css'

function count(faces: CoinFace[], face: CoinFace) {
  return faces.filter(item => item === face).length
}

function summary(faces: CoinFace[]) {
  if (faces.length === 1) return faces[0] === 'heads' ? 'Heads' : 'Tails'
  const heads = count(faces, 'heads')
  return heads + (heads === 1 ? ' head' : ' heads') + ' · ' + (faces.length - heads) + (faces.length - heads === 1 ? ' tail' : ' tails')
}

interface CoinFlipProps {
  coins: number
  onSearchWeb: () => void
  flip?: (count: number) => CoinFace[]
}

export function CoinFlip({ coins, onSearchWeb, flip = randomFaces }: CoinFlipProps) {
  const [round, setRound] = useState(() => {
    const faces = flip(coins)
    return { faces, flips: 1, heads: count(faces, 'heads'), tails: count(faces, 'tails') }
  })
  const titleId = useId()

  function flipAgain() {
    const faces = flip(coins)
    setRound(previous => ({
      faces, flips: previous.flips + 1,
      heads: previous.heads + count(faces, 'heads'), tails: previous.tails + count(faces, 'tails'),
    }))
  }

  return (
    <section className="answer coin-flip" aria-labelledby={titleId}>
      <h2 id={titleId}>{coins === 1 ? 'Coin flip' : 'Flip ' + coins + ' coins'}</h2>
      <div className="coin-flip-body" data-many={coins > 1 || undefined}>
        <div className="coin-flip-coins" aria-hidden="true">
          {round.faces.map((face, index) => (
            <span key={round.flips + '-' + index} className="coin" data-face={face}
              style={{ '--coin-delay': Math.min(index, 9) * 35 + 'ms' } as CSSProperties}>
              <span className="coin-face coin-heads">H</span>
              <span className="coin-face coin-tails">T</span>
            </span>
          ))}
        </div>
        <div className="coin-flip-text">
          <output className="coin-flip-result" aria-live="polite" aria-label="Result">
            <span key={round.flips}>{summary(round.faces)}</span>
          </output>
          {round.flips > 1 && (
            <p className="coin-flip-tally">
              Heads {round.heads} · Tails {round.tails} over {round.flips} {coins === 1 ? 'flips' : 'rounds'}
            </p>
          )}
        </div>
      </div>
      <div className="coin-flip-actions">
        <button className="secondary-button" type="button" onClick={flipAgain}>Flip again</button>
        <button className="text-button" type="button" onClick={onSearchWeb}>Search the web</button>
      </div>
    </section>
  )
}

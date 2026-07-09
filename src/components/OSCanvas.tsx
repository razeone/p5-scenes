/**
 * OSCanvas.tsx — Mounts the p5 OS sketch into the DOM and hands the
 * imperative controller back up to the parent via a ref callback.
 *
 * StrictMode double-invokes effects in dev; we guard so we never spin up
 * two p5 instances (which would stack two canvases).
 */

import { useEffect, useRef } from 'react'
import { createOSApp, type OSController, type OSHooks } from '../os/OSApp'

interface Props {
  onReady?: (controller: OSController) => void
  hooks?: OSHooks
}

export default function OSCanvas({ onReady, hooks }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<OSController | null>(null)

  useEffect(() => {
    if (!hostRef.current || controllerRef.current) return
    const controller = createOSApp(hostRef.current, hooks ?? {})
    controllerRef.current = controller
    onReady?.(controller)
    return () => {
      controller.destroy()
      controllerRef.current = null
    }
    // Mount once; controller identity is stable for the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div className="os-host" ref={hostRef} />
}

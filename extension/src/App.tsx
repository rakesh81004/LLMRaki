import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Markdown from './Markdown'
import { HistoryIcon, PaperclipIcon, PlusIcon, SettingsIcon } from './Icons'
import { PendingChips, SentAttachments, type PendingFile } from './AttachmentChips'
import { ACCEPT, MAX_FILES, readAttachment } from './attachments'
import { restartExtension, updateWaiting } from './updates'
import { markGroupsIdle } from './tabGroup'
import { allAutomations, findTriggered, loadBuiltInAutomations, prepareAutomation, type AutomationInfo } from './automations'
import QueueList, { type QueuedMessage } from './QueueList'
import SettingsView from './SettingsView'
import HistoryView from './HistoryView'
import StepList from './StepList'
import { runAgent, undoFill } from './agent'
import GeminiSetup from './GeminiSetup'
import { APPROVAL_PREFIX, clearApprovalNotification, notify, plainText, playSound, type AlertKind } from './alerts'
import { activeModel, listOllamaModels, PROVIDER_LABELS } from './providers'
import { providerChain, streamChat, type RateLimitHooks } from './llm'
import type { LimitReason } from './limits'
import {
  getTargetTab,
  hasPageAccess,
  readActivePage,
  requestPageAccess
} from './pageContext'
import type { TabTarget } from './pageContext'
import { deleteConversation, loadConversations, loadSettings, saveConversation, saveSettings } from './storage'
import type { AgentStep, ChatMessage, Conversation, Mode, PageContext, Settings } from './types'

type View = 'chat' | 'history' | 'settings' | 'setup' | 'backups'

const SUGGESTIONS = [
  'Summarize this page',
  'What are the key takeaways here?',
  'Explain the selected text in simple terms'
]

const AGENT_SUGGESTIONS = [
  'Apply to 10 fresh jobs on Naukri that match my résumé',
  'Fill in this form from my profile',
  'Read this page and list what I can do here'
]

// A task that runs out of rounds carries on after this countdown, up to this many times in a row.
const AUTO_CONTINUE_SECONDS = 10
const MAX_AUTO_CONTINUES = 5

const MODE_LABELS: Record<Mode, string> = { ask: 'Ask', edit: 'Edit', auto: 'Auto' }

const MODE_HINTS: Record<Mode, string> = {
  ask: 'Ask: chat only — the page is never changed',
  edit: 'Edit: reads the page and fills in fields directly (with undo); asks before every click',
  auto: 'Auto: fills in fields and clicks on its own; still asks before submitting, sending, paying or deleting'
}

const EMPTY_TEXT: Record<Mode, string> = {
  ask: "Ask anything, or attach the page you're reading.",
  edit: 'Describe what to fill in. You approve every click.',
  auto: 'Describe the task. LLMRaki fills and clicks, and checks with you before anything final.'
}

// Same mode colours as the desktop app's chat.
const MODE_RGB: Record<Mode, string> = {
  ask: '52, 211, 153',
  edit: '168, 85, 247',
  auto: '255, 140, 0'
}

function newConversation(): Conversation {
  const now = Date.now()
  return { id: crypto.randomUUID(), title: 'New chat', createdAt: now, updatedAt: now, messages: [] }
}

function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0]
  return line.length > 60 ? `${line.slice(0, 57)}…` : line || 'New chat'
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname || url
  } catch {
    return url
  }
}

export default function App(): JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [conversation, setConversation] = useState<Conversation>(newConversation)
  const [view, setView] = useState<View>('chat')
  const [input, setInput] = useState('')
  const [files, setFiles] = useState<PendingFile[]>([])
  // Built-in automations (from the bundled automations/ folders) plus the user's own.
  const [builtInAutomations, setBuiltInAutomations] = useState<AutomationInfo[]>([])
  useEffect(() => {
    void loadBuiltInAutomations().then(setBuiltInAutomations)
  }, [])
  const automations = allAutomations(builtInAutomations, settings?.customAutomations ?? [])
  // Messages sent while a run is going. The ref is what a running task reads between steps.
  const [queue, setQueue] = useState<QueuedMessage[]>([])
  const queueRef = useRef<QueuedMessage[]>([])
  const [queuePaused, setQueuePaused] = useState(false)
  // A task that stopped at the step limit and will carry on by itself when the countdown ends.
  const [autoContinue, setAutoContinue] = useState<{ until: number; task: string; count: number; startedAt: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [attachPage, setAttachPage] = useState(false)
  const [activeTab, setActiveTab] = useState<TabTarget | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  // Steps waiting on the user, answered with the index of the button pressed (-1: cancelled).
  const approvalsRef = useRef(new Map<string, (choice: number) => void>())
  // An ask_user question waiting for an answer: a message typed meanwhile answers it, resolving the
  // step with `typed` (the index just past its options).
  const questionRef = useRef<{ stepId: string; typed: number } | null>(null)
  // When a rate-limit pause ends; drives the countdown shown in the reply being written.
  const [waitUntil, setWaitUntil] = useState<number | null>(null)
  const [waitReason, setWaitReason] = useState<LimitReason>('rate')
  const [, setTick] = useState(0)
  useEffect(() => {
    if (waitUntil === null) return
    const timer = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(timer)
  }, [waitUntil])
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    void loadSettings().then(async (loaded) => {
      let s = loaded
      // Older installs defaulted to Ollama. If nobody picked it on purpose and it isn't running, move to Gemini.
      if (!s.providerChosen && s.provider === 'ollama' && (await listOllamaModels()).length === 0) {
        s = { ...s, provider: 'gemini' }
        void saveSettings(s)
      }
      setSettings(s)
      if (s.provider === 'gemini' && !s.geminiKey) setView('setup')
      else if (
        (s.provider === 'openai' && !s.openaiKey) ||
        (s.provider === 'groq' && !s.groqKey) ||
        (s.provider === 'mistral' && !s.mistralKey)
      ) {
        setView('settings')
      }
    })
    void loadConversations().then(setConversations)
  }, [])

  // A newer build on disk than the one Chrome is running: restart straight away when the panel
  // opens (nothing is in progress yet); while it stays open, offer a restart instead of interrupting.
  const [updateReady, setUpdateReady] = useState(false)
  useEffect(() => {
    void updateWaiting().then((waiting) => {
      if (waiting) restartExtension()
    })
    const timer = setInterval(() => void updateWaiting().then(setUpdateReady), 30_000)
    return () => clearInterval(timer)
  }, [])

  // Keep the composer naming whichever tab LLMRaki would read or act on right now, and whether it can.
  // Only needed for the Page button's tooltip; Edit and Auto check the tab when a message is sent.
  const watchTab = attachPage
  useEffect(() => {
    if (!watchTab) return
    const refresh = (): void =>
      void getTargetTab()
        .then(setActiveTab)
        .catch(() => setActiveTab(null))
    refresh()
    chrome.tabs.onActivated.addListener(refresh)
    chrome.tabs.onUpdated.addListener(refresh)
    chrome.windows.onFocusChanged.addListener(refresh)
    return () => {
      chrome.tabs.onActivated.removeListener(refresh)
      chrome.tabs.onUpdated.removeListener(refresh)
      chrome.windows.onFocusChanged.removeListener(refresh)
    }
  }, [watchTab])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight
  }, [conversation.messages])

  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [input])

  const onScroll = (): void => {
    const el = scrollRef.current
    if (el) stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  const enablePageAttach = (): void => {
    // Ask synchronously inside the click so the browser treats it as user-initiated.
    void requestPageAccess().then((granted) => {
      setAttachPage(granted)
      setNotice(granted ? null : 'Page reading was not allowed, so the page won\'t be attached.')
    })
  }

  const togglePageAttach = (): void => {
    if (attachPage) setAttachPage(false)
    else enablePageAttach()
  }

  // Sound and a system notification, each as the user has set them in Settings.
  const alertUser = (
    kind: AlertKind,
    title: string,
    message: string,
    options: { stepId?: string; context?: string; buttons?: string[]; id?: string; progress?: { count: number; goal?: number } } = {}
  ): void => {
    if (!settings) return
    if (settings.sound) playSound(kind, options.progress)
    if (settings.notifications) notify(kind, title, message, options)
  }

  const send = useCallback(
    // `queued` is a message from the queue: it brings its own files and page choice, and leaves
    // whatever the user is typing now untouched.
    async (text: string, queued?: QueuedMessage) => {
      let ready = queued
        ? (queued.attachments ?? [])
        : files.filter((f) => f.status === 'ready' && f.attachment).map((f) => f.attachment!)
      if (!settings || streaming || (!text.trim() && ready.length === 0)) return
      if (!queued && files.some((f) => f.status === 'reading')) {
        setNotice('Still reading your files — send again in a moment.')
        return
      }
      setNotice(null)
      if (!queued) setQueuePaused(false)
      if (!queued?.continuation) setAutoContinue(null)

      // A queued message that can't start goes back to the front of the queue, which pauses.
      const cantStart = (message: string): void => {
        setNotice(message)
        if (queued) {
          queueRef.current = [queued, ...queueRef.current]
          setQueue(queueRef.current)
          setQueuePaused(true)
        }
      }

      let page: PageContext | undefined
      if (queued ? queued.attachPage : attachPage) {
        try {
          page = await readActivePage()
        } catch (err) {
          cantStart(err instanceof Error ? err.message : String(err))
          return
        }
      }

      // An automation — its trigger word in the message, or chosen with Run — brings its own mode,
      // instructions and media files. A continuation doesn't re-attach them: they're already above.
      const automation = queued?.continuation
        ? undefined
        : queued?.automation
          ? automations.find((a) => a.name === queued.automation)
          : findTriggered(text, automations)
      if (automation) {
        try {
          ready = [...(await prepareAutomation(automation)), ...ready]
        } catch (err) {
          cantStart(err instanceof Error ? err.message : String(err))
          return
        }
        if (automation.mode !== settings.mode) {
          const next = { ...settings, mode: automation.mode }
          setSettings(next)
          void saveSettings(next)
        }
      }

      const mode = automation?.mode ?? settings.mode
      // The automation this chat runs under: one started now, or the one the chat began with, so
      // replies to its question carry on with the same rules. Its auto-approved sites apply once the
      // user has answered its question — a typed reply to it counts too.
      const chatAutomation = automation ?? automations.find((a) => a.name === conversation.automation)
      let automationApproved = automation
        ? false
        : !!chatAutomation && (!!conversation.automationApproved || (!queued?.continuation && conversation.messages.length > 0))
      // Edit and Auto start on the tab that was in front when the message was sent, even if the user
      // switches tabs mid-run. From a browser page (New Tab, Settings…) they get to a website themselves.
      let tabId: number | undefined
      let startProblem: string | undefined
      if (mode !== 'ask') {
        const target = await getTargetTab().catch(
          (err): TabTarget => ({ title: 'This tab', problem: `Couldn't check this tab: ${err instanceof Error ? err.message : String(err)}` })
        )
        setActiveTab(target)
        if ((target.problem && !target.browserPage) || !target.tabId) {
          cantStart(target.problem ?? 'No tab to work on.')
          return
        }
        if (target.browserPage) startProblem = target.url ? `it's ${target.url.split(/[?#]/)[0]}` : "it's a Chrome page such as New Tab"
        if (!(await hasPageAccess())) {
          cantStart('Edit and Auto need permission to read and change pages. Turn on “Reading web pages” in Settings.')
          return
        }
        tabId = target.tabId
      }

      const userMessage: ChatMessage = {
        role: 'user',
        content: text.trim() || `Please look at the attached file${ready.length === 1 ? '' : 's'}.`,
        mode,
        ...(page ? { page } : {}),
        ...(ready.length ? { attachments: ready } : {})
      }
      const history = [...conversation.messages, userMessage]
      const pending: ChatMessage = { role: 'assistant', content: '', mode, ...(mode !== 'ask' ? { steps: [] } : {}) }
      const base: Conversation = {
        ...conversation,
        title: conversation.messages.length === 0 ? titleFrom(text) : conversation.title,
        updatedAt: Date.now(),
        messages: [...history, pending],
        ...(chatAutomation ? { automation: chatAutomation.name, automationApproved } : {})
      }
      setConversation(base)
      if (!queued) {
        setInput('')
        setFiles([])
        setAttachPage(false)
      }
      setStreaming(true)
      stickToBottomRef.current = true

      const controller = new AbortController()
      abortRef.current = controller
      let reply = ''
      let failed = false
      let errorText = ''
      let hitLimit = false
      // The task this run belongs to: the user's own message, or the task a continuation carries on.
      const task = queued?.continuation?.task ?? text.trim()
      const continueCount = queued?.continuation?.count ?? 0
      const taskStartedAt = queued?.continuation?.startedAt ?? Date.now()
      const willContinue = (): boolean =>
        hitLimit && !failed && !controller.signal.aborted && settings.autoContinue !== false &&
        continueCount < MAX_AUTO_CONTINUES && queueRef.current.length === 0
      const steps: AgentStep[] = []

      let note: string | undefined
      const show = (content: string, error = false): void => {
        setWaitUntil(null)
        setConversation((c) =>
          c.id === base.id
            ? {
                ...c,
                messages: [
                  ...history,
                  {
                    ...pending,
                    content,
                    ...(steps.length ? { steps: [...steps] } : {}),
                    ...(error ? { error } : {}),
                    ...(note ? { note } : {})
                  }
                ]
              }
            : c
        )
      }
      // Which backups ended up answering (when the main provider was at its limit), for the note under the reply.
      const backups = new Set<string>()
      const rateLimit: RateLimitHooks = {
        onWait: (seconds, reason) => {
          setWaitReason(reason)
          setWaitUntil(Date.now() + seconds * 1000)
        },
        onAnswer: (provider, model) => {
          if (provider === settings.provider && model === activeModel(settings)) return
          backups.add(provider === settings.provider ? model : `${PROVIDER_LABELS[provider]} (${model})`)
          note = `Answered by ${[...backups].join(', ')} — ${activeModel(settings)} was busy or at its free limit.`
        }
      }

      try {
        if (mode === 'ask') {
          for await (const chunk of streamChat(settings, history, controller.signal, rateLimit)) {
            reply += chunk
            show(reply)
          }
        } else {
          const result = await runAgent(settings, mode, history, tabId!, controller.signal, {
            onStep: (step) => {
              const i = steps.findIndex((s) => s.id === step.id)
              if (i === -1) steps.push(step)
              else steps[i] = step
              show(reply)
            },
            requestApproval: (step) =>
              new Promise<boolean>((resolve) => {
                if (controller.signal.aborted) return resolve(false)
                approvalsRef.current.set(step.id, (choice) => resolve(choice === 0))
                alertUser('approval', 'LLMRaki needs your OK', `${step.label}${step.detail ? ` — ${step.detail}` : ''}`, {
                  stepId: step.id,
                  context: 'Allow or Deny here, or in the side panel'
                })
              }),
            requestChoice: (step, alert, timeoutMs, fallback) =>
              new Promise<number>((resolve) => {
                if (controller.signal.aborted) return resolve(fallback)
                const question = step.kind === 'question'
                const choices = step.choices ?? []
                let settled = false
                const finish = (choice: number): void => {
                  if (settled) return
                  settled = true
                  clearTimeout(timer)
                  approvalsRef.current.delete(step.id)
                  if (questionRef.current?.stepId === step.id) questionRef.current = null
                  clearApprovalNotification(step.id)
                  resolve(choice < 0 ? fallback : choice)
                }
                // Nobody answering doesn't hold up the rest of the task forever.
                const timer = setTimeout(() => finish(fallback), timeoutMs)
                approvalsRef.current.set(step.id, finish)
                if (question) questionRef.current = { stepId: step.id, typed: choices.length }
                // A notification fits two buttons; questions with more options are answered in the panel.
                alertUser(question ? 'approval' : 'error', alert.title, alert.message, {
                  stepId: step.id,
                  context: alert.context,
                  buttons: question && choices.length > 2 ? [] : choices
                })
              }),
            // Each application that goes through gets its own sound and notification: "Applied 3/10".
            onApplied: ({ title, company, count, goal }) => {
              const progress = goal ? `Applied ${count}/${goal}` : `Applied ${count}`
              alertUser('applied', `Applied: ${company} — ${title}`, progress, {
                id: `llmraki-applied-${Date.now()}`,
                context: goal && count >= goal ? 'All done ✓' : undefined,
                progress: { count, goal }
              })
            },
            onAnswered: () => {
              automationApproved = true
              setConversation((c) => (c.id === base.id && c.automation ? { ...c, automationApproved: true } : c))
            },
            rateLimit,
            takeMessages: takeForRunningTask
          }, {
            startProblem,
            task: { text: task, startedAt: taskStartedAt },
            ...(chatAutomation?.autoApprove?.length ? { automation: { sites: chatAutomation.autoApprove, approved: automationApproved } } : {})
          })
          reply = result.text
          hitLimit = !!result.hitLimit
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          failed = true
          errorText = err instanceof Error ? err.message : String(err)
          show(errorText, true)
        }
      } finally {
        abortRef.current = null
        setWaitUntil(null)
      }

      // Stopped or failed: hold the queue rather than firing the next message into the same problem.
      if (controller.signal.aborted || failed) setQueuePaused(true)
      // The task is over: its tab group stays, but no longer says "working".
      if (mode !== 'ask') void markGroupsIdle()
      try {
      if (controller.signal.aborted && !reply) reply = '_Stopped._'
      if (!failed) show(reply)

      // Let the user know the run is over — unless they stopped it themselves.
      if (!controller.signal.aborted) {
        const actions = steps.filter((s) => s.status === 'done' && s.kind !== 'read').length
        if (failed) {
          alertUser('error', 'LLMRaki stopped', errorText.split('\n')[0])
        } else if (willContinue()) {
          // Not finished yet — it carries on by itself, so no "done" alert.
        } else if (hitLimit) {
          alertUser('done', 'LLMRaki paused', 'It reached the step limit. Send a message to continue the task.')
        } else {
          const summary = plainText(reply) || 'Done.'
          alertUser(
            'done',
            mode === 'ask' ? 'LLMRaki replied' : 'LLMRaki finished the task',
            summary,
            mode === 'ask' ? {} : { context: `${actions} page action${actions === 1 ? '' : 's'} done` }
          )
        }
      }

      // A failed turn stays on screen but only its completed page actions are saved — the history
      // shouldn't fill with error text, yet later turns still need to know what was changed.
      const saved: ChatMessage = failed
        ? { ...pending, content: '', steps: [...steps] }
        : { ...pending, content: reply, ...(steps.length ? { steps: [...steps] } : {}), ...(note ? { note } : {}) }
      const keep = !failed || steps.length > 0
      const toSave: Conversation = {
        ...base,
        updatedAt: Date.now(),
        messages: keep ? [...history, saved] : history,
        ...(chatAutomation ? { automationApproved } : {})
      }
      setConversations(await saveConversation(toSave))
      if (willContinue()) setAutoContinue({ until: Date.now() + AUTO_CONTINUE_SECONDS * 1000, task, count: continueCount + 1, startedAt: taskStartedAt })
      } finally {
        // Only now is the run fully over (reply shown and saved), so a queued message can start.
        setStreaming(false)
      }
    },
    [settings, streaming, attachPage, conversation, files, automations]
  )

  const runAutomation = (name: string): void => {
    const automation = automations.find((a) => a.name === name)
    if (!automation) return
    setView('chat')
    const text = automation.trigger || `Run the ${automation.title} automation`
    const item = { id: crypto.randomUUID(), text, automation: name }
    if (streaming) {
      queueRef.current = [...queueRef.current, item]
      setQueue(queueRef.current)
    } else {
      void send(text, item)
    }
  }

  const typedAutomation = !streaming && input.trim() ? findTriggered(input, automations) : undefined

  // ---- Message queue: what the user sends while a run is still going ----

  const enqueue = (text: string): void => {
    const attachments = files.filter((f) => f.status === 'ready' && f.attachment).map((f) => f.attachment!)
    if (!text.trim() && attachments.length === 0) return
    if (files.some((f) => f.status === 'reading')) {
      setNotice('Still reading your files — queue the message again in a moment.')
      return
    }
    const item: QueuedMessage = {
      id: crypto.randomUUID(),
      text: text.trim(),
      ...(attachments.length ? { attachments } : {}),
      ...(attachPage ? { attachPage: true } : {})
    }
    queueRef.current = [...queueRef.current, item]
    setQueue(queueRef.current)
    setInput('')
    setFiles([])
    setAttachPage(false)
    // Typed while LLMRaki is waiting on its question: this is the answer.
    const waiting = questionRef.current
    if (waiting && !item.attachments && !item.attachPage) answerApproval(waiting.stepId, waiting.typed)
  }

  const removeQueued = (id: string): void => {
    queueRef.current = queueRef.current.filter((q) => q.id !== id)
    setQueue(queueRef.current)
  }

  // Edit/Auto runs read plain text messages between steps. Messages with files or a page attached
  // wait for their own turn, and order is kept: nothing jumps ahead of a waiting message.
  const takeForRunningTask = (): string[] => {
    const taken: string[] = []
    while (queueRef.current.length > 0 && !queueRef.current[0].attachments && !queueRef.current[0].attachPage && queueRef.current[0].text) {
      taken.push(queueRef.current[0].text)
      queueRef.current = queueRef.current.slice(1)
    }
    if (taken.length > 0) setQueue(queueRef.current)
    return taken
  }

  // When a run is over, the next queued message goes out by itself (unless the queue is paused).
  const sendRef = useRef(send)
  sendRef.current = send
  useEffect(() => {
    if (streaming || queuePaused || queue.length === 0) return
    const [next, ...rest] = queue
    queueRef.current = rest
    setQueue(rest)
    void sendRef.current(next.text, next)
  }, [streaming, queuePaused, queue])

  // Counts down, then carries on with a task that stopped at the step limit.
  useEffect(() => {
    if (!autoContinue) return
    const timer = setInterval(() => {
      setTick((t) => t + 1)
      if (Date.now() < autoContinue.until) return
      clearInterval(timer)
      setAutoContinue(null)
      continueNow(autoContinue)
    }, 250)
    return () => clearInterval(timer)
  }, [autoContinue])

  const continueNow = (pendingContinue: { task: string; count: number; startedAt: number }): void => {
    setAutoContinue(null)
    const text =
      `Continue the task: “${pendingContinue.task}”. You paused because you reached the step limit — the steps you already completed are listed above. ` +
      "Pick up exactly where you left off, don't redo finished work, and keep going until the whole task is done."
    void sendRef.current(text, { id: crypto.randomUUID(), text, continuation: pendingContinue })
  }

  const sendNextQueued = (): void => {
    setQueuePaused(false)
  }

  // Reads each file into an attachment in the background; chips show progress and any problem.
  const addFiles = (incoming: File[]): void => {
    if (incoming.length === 0) return
    const room = MAX_FILES - files.length
    if (room <= 0) {
      setNotice(`Up to ${MAX_FILES} files can be attached to one message.`)
      return
    }
    if (incoming.length > room) setNotice(`Only the first ${room} file${room === 1 ? '' : 's'} were attached (up to ${MAX_FILES} per message).`)
    for (const file of incoming.slice(0, room)) {
      const id = crypto.randomUUID()
      setFiles((list) => [...list, { id, name: file.name || 'pasted image', size: file.size, status: 'reading' }])
      void readAttachment(file).then(
        (attachment) => setFiles((list) => list.map((f) => (f.id === id ? { ...f, status: 'ready', attachment } : f))),
        (err) =>
          setFiles((list) =>
            list.map((f) => (f.id === id ? { ...f, status: 'error', error: err instanceof Error ? err.message : String(err) } : f))
          )
      )
    }
  }

  const fileErrors = files.filter((f) => f.status === 'error')

  const stop = (): void => {
    setAutoContinue(null)
    abortRef.current?.abort()
    for (const [stepId, resolve] of approvalsRef.current) {
      resolve(-1)
      clearApprovalNotification(stepId)
    }
    approvalsRef.current.clear()
  }

  const answerApproval = (stepId: string, choice: number): void => {
    approvalsRef.current.get(stepId)?.(choice)
    approvalsRef.current.delete(stepId)
    clearApprovalNotification(stepId)
  }

  // Allow / Deny can be answered straight from the notification; clicking one brings Chrome to the front.
  useEffect(() => {
    if (!chrome.notifications) return
    const onButton = (id: string, buttonIndex: number): void => {
      if (!id.startsWith(APPROVAL_PREFIX)) return
      const stepId = id.slice(APPROVAL_PREFIX.length)
      approvalsRef.current.get(stepId)?.(buttonIndex)
      approvalsRef.current.delete(stepId)
      void chrome.notifications.clear(id)
    }
    const onClick = (id: string): void => {
      if (!id.startsWith('llmraki-')) return
      void chrome.windows.getCurrent().then((w) => {
        if (w.id !== undefined) void chrome.windows.update(w.id, { focused: true })
      })
      if (!id.startsWith(APPROVAL_PREFIX)) void chrome.notifications.clear(id)
    }
    chrome.notifications.onButtonClicked.addListener(onButton)
    chrome.notifications.onClicked.addListener(onClick)
    return () => {
      chrome.notifications.onButtonClicked.removeListener(onButton)
      chrome.notifications.onClicked.removeListener(onClick)
    }
  }, [])

  const undoStep = async (messageIndex: number, step: AgentStep): Promise<void> => {
    if (!(await undoFill(step))) {
      setNotice("Couldn't undo that change — the page may have changed since.")
      return
    }
    const next: Conversation = {
      ...conversation,
      messages: conversation.messages.map((m, i) =>
        i === messageIndex && m.steps
          ? { ...m, steps: m.steps.map((s) => (s.id === step.id ? { ...s, status: 'undone' as const, undo: undefined } : s)) }
          : m
      )
    }
    setConversation(next)
    setConversations(await saveConversation(next))
  }

  const changeMode = (mode: Mode): void => {
    if (!settings || mode === settings.mode) return
    const apply = (): void => {
      const next = { ...settings, mode }
      setSettings(next)
      void saveSettings(next)
      setNotice(null)
    }
    if (mode === 'ask') return apply()
    // Requested inside the click so the browser shows its permission prompt.
    void requestPageAccess().then((granted) => {
      if (granted) apply()
      else setNotice('Edit and Auto need permission to read and change pages, so the mode was not changed.')
    })
  }

  const clearQueue = (): void => {
    queueRef.current = []
    setQueue([])
    setQueuePaused(false)
  }

  const startNewChat = (): void => {
    setAutoContinue(null)
    stop()
    clearQueue()
    setConversation(newConversation())
    setView('chat')
    setNotice(null)
    textareaRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (streaming) enqueue(input)
      else void send(input)
    }
  }

  const applySuggestion = (text: string): void => {
    setInput(text)
    if (settings?.mode === 'ask' && !attachPage) enablePageAttach()
    textareaRef.current?.focus()
  }

  if (!settings) return <div className="app" />

  if (view === 'setup' || view === 'backups') {
    return (
      <div className="app">
        <GeminiSetup
          settings={settings}
          backupsOnly={view === 'backups'}
          onOtherProvider={() => setView('settings')}
          onDone={(next) => {
            setSettings(next)
            void saveSettings(next)
            setNotice(null)
            setView('chat')
          }}
        />
      </div>
    )
  }

  if (view === 'settings') {
    return (
      <div className="app">
        <SettingsView
          settings={settings}
          automations={builtInAutomations}
          onRunAutomation={runAutomation}
          onClose={() => setView('chat')}
          onSave={(next) => {
            const chosen = { ...next, providerChosen: true }
            setSettings(chosen)
            void saveSettings(chosen)
            setView('chat')
          }}
        />
      </div>
    )
  }

  if (view === 'history') {
    return (
      <div className="app">
        <HistoryView
          conversations={conversations}
          activeId={conversation.id}
          onClose={() => setView('chat')}
          onOpen={(c) => {
            stop()
            clearQueue()
            setConversation(c)
            setView('chat')
          }}
          onDelete={(id) => {
            void deleteConversation(id).then(setConversations)
            if (id === conversation.id) setConversation(newConversation())
          }}
        />
      </div>
    )
  }

  const empty = conversation.messages.length === 0
  const agentMode = settings.mode !== 'ask'

  return (
    <div
      className="app"
      data-mode={settings.mode}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        setDragging(false)
        addFiles(Array.from(e.dataTransfer.files))
      }}
    >
      {dragging && <div className="drop-overlay">Drop files to attach them</div>}
      <header className="topbar">
        <img src="icons/icon32.png" alt="" className="topbar-logo" />
        <span className="topbar-title" title={conversation.title}>
          {empty ? 'LLMRaki' : conversation.title}
        </span>
        <button className="icon-button" title="New chat" onClick={startNewChat}>
          <PlusIcon />
        </button>
        <button className="icon-button" title="Chat history" onClick={() => setView('history')}>
          <HistoryIcon />
        </button>
        <button className="icon-button" title="Settings" onClick={() => setView('settings')}>
          <SettingsIcon />
        </button>
      </header>

      <div className="messages" ref={scrollRef} onScroll={onScroll}>
        {empty ? (
          <div className="empty-state">
            <img src="icons/icon128.png" alt="" />
            <p>{EMPTY_TEXT[settings.mode]}</p>
            {automations.length > 0 && (
              <div className="automation-chips">
                {automations.map((a) => (
                  <button key={a.name} className="automation-chip" title={a.description} onClick={() => runAutomation(a.name)}>
                    ▶ {a.title}
                  </button>
                ))}
              </div>
            )}
            {providerChain(settings).length === 1 && settings.provider !== 'ollama' && (
              <button className="backup-nudge" onClick={() => setView('backups')}>
                <strong>Add free backups</strong> — Groq and Mistral take over when {PROVIDER_LABELS[settings.provider]} hits
                its free limit, so LLMRaki doesn't stop.
              </button>
            )}
            <div className="suggestions">
              {(agentMode ? AGENT_SUGGESTIONS : SUGGESTIONS).map((s) => (
                <button key={s} className="suggestion" onClick={() => applySuggestion(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          conversation.messages.map((m, i) => (
            <div
              key={i}
              className={`message ${m.role}${m.error ? ' error' : ''}`}
              style={m.mode ? ({ '--msg-mode-rgb': MODE_RGB[m.mode] } as React.CSSProperties) : undefined}
            >
              {m.page && (
                <a className="page-chip" href={m.page.url} target="_blank" rel="noreferrer" title={m.page.url}>
                  {m.page.kind === 'selection' ? 'Selection from ' : ''}
                  {m.page.title}
                  <span className="page-chip-host">{hostOf(m.page.url)}</span>
                </a>
              )}
              {m.steps && m.steps.length > 0 && (
                <StepList
                  steps={m.steps}
                  onAnswer={answerApproval}
                  onUndo={(step) => void undoStep(i, step)}
                />
              )}
              {m.role === 'user' ? (
                <>
                  {m.attachments && m.attachments.length > 0 && <SentAttachments attachments={m.attachments} />}
                  <div className="user-text">{m.content}</div>
                </>
              ) : m.content ? (
                m.error ? (
                  <div>
                    {m.content}
                    {/key|ollama|provider|settings/i.test(m.content) && (
                      <div className="error-actions">
                        <button
                          className="ghost-button small"
                          onClick={() => setView(settings.provider === 'gemini' && !settings.geminiKey ? 'setup' : 'settings')}
                        >
                          Open Settings
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <Markdown content={m.content} />
                )
              ) : streaming && i === conversation.messages.length - 1 && waitUntil === null ? (
                <div className="thinking">
                  <span />
                  <span />
                  <span />
                </div>
              ) : null}
              {streaming && waitUntil !== null && i === conversation.messages.length - 1 && (
                <div className="rate-wait" role="status">
                  {waitReason === 'busy'
                    ? providerChain(settings).length > 1
                      ? 'Your AI providers are overloaded right now (a temporary problem on their side).'
                      : `${PROVIDER_LABELS[settings.provider]} is overloaded right now (a temporary problem on Google's side).`
                    : providerChain(settings).length > 1
                      ? 'Every AI provider you set up is at its free limit for the moment.'
                      : `${PROVIDER_LABELS[settings.provider]}'s free limit for this minute is used up.`}{' '}
                  {waitReason === 'busy' ? 'Retrying' : 'Continuing'} automatically in{' '}
                  <strong>{Math.max(0, Math.ceil((waitUntil - Date.now()) / 1000))}s</strong> — your task carries on from where it stopped.
                  {providerChain(settings).length === 1 && (
                    <div className="rate-wait-tip">
                      Add free Groq or Mistral keys in{' '}
                      <button className="link-button" onClick={() => setView('settings')}>
                        Settings
                      </button>{' '}
                      and LLMRaki switches to them instead of waiting.
                    </div>
                  )}
                </div>
              )}
              {m.note && <div className="message-note">{m.note}</div>}
            </div>
          ))
        )}
      </div>

      {autoContinue && !streaming && (
        <div className="update-banner continue-banner" role="status">
          <span>
            Paused at the step limit — continuing automatically in{' '}
            <strong>{Math.max(0, Math.ceil((autoContinue.until - Date.now()) / 1000))}s</strong>
            <span className="continue-count">
              {' '}
              (auto-continue {autoContinue.count} of {MAX_AUTO_CONTINUES})
            </span>
          </span>
          <button className="primary-button small" onClick={() => continueNow(autoContinue)}>
            Continue now
          </button>
          <button className="ghost-button small" onClick={() => setAutoContinue(null)}>
            Cancel
          </button>
        </div>
      )}

      {updateReady && !streaming && (
        <div className="update-banner" role="status">
          A new version of LLMRaki is ready.
          <button className="primary-button small" onClick={restartExtension}>
            Restart to update
          </button>
        </div>
      )}

      {notice && (
        <div className="notice" role="status">
          {notice}
          <button className="link-button" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      {fileErrors.length > 0 && (
        <div className="notice" role="status">
          {fileErrors[0].error}
          <button className="link-button" onClick={() => setFiles((list) => list.filter((f) => f.status !== 'error'))}>
            Dismiss
          </button>
        </div>
      )}

      {queue.length > 0 && (
        <QueueList
          queue={queue}
          paused={queuePaused && !streaming}
          agentRunning={streaming && agentMode}
          onRemove={removeQueued}
          onEdit={(item) => {
            removeQueued(item.id)
            setInput(item.text)
            textareaRef.current?.focus()
          }}
          onResume={sendNextQueued}
        />
      )}

      <div className="composer">
        {typedAutomation && (
          <div className="automation-hint">
            ⚡ Runs the <strong>{typedAutomation.title}</strong> automation in {MODE_LABELS[typedAutomation.mode]} mode
            {typedAutomation.builtIn
              ? ` with ${(typedAutomation.mediaPaths?.length ?? 0) + 1} file${(typedAutomation.mediaPaths?.length ?? 0) === 0 ? '' : 's'}`
              : ` with ${(typedAutomation.media?.length ?? 0) + 1} file${(typedAutomation.media?.length ?? 0) === 0 ? '' : 's'}`}
          </div>
        )}
        {files.length > 0 && (
          <PendingChips files={files} onRemove={(id) => setFiles((list) => list.filter((f) => f.id !== id))} />
        )}
        <textarea
          ref={textareaRef}
          value={input}
          rows={1}
          autoFocus
          placeholder={
            streaming
              ? agentMode
                ? 'Add to the task — LLMRaki reads it before its next step…'
                : 'Type your next message — it’s sent when this reply finishes…'
              : agentMode
              ? 'Tell LLMRaki what to do on this page…'
              : attachPage
                ? 'Ask about this page…'
                : files.length > 0
                  ? 'Ask about the attached files…'
                  : 'Message LLMRaki…'
          }
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            // Pasting a screenshot or a copied file attaches it instead of pasting nothing.
            const pasted = Array.from(e.clipboardData.files)
            if (pasted.length > 0) {
              e.preventDefault()
              addFiles(pasted)
            }
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
        <div className="composer-bar">
          <button
            className="icon-button attach-button"
            title="Attach files — PDF, Word, text, code or images (or drag them here / paste an image)"
            aria-label="Attach files"
            onClick={() => fileInputRef.current?.click()}
          >
            <PaperclipIcon />
          </button>
          <div className="mode-row" role="radiogroup" aria-label="Mode">
            {(['ask', 'edit', 'auto'] as Mode[]).map((m) => (
              <button
                key={m}
                role="radio"
                aria-checked={settings.mode === m}
                className={`mode-button${settings.mode === m ? ' active' : ''}`}
                data-mode={m}
                disabled={streaming}
                title={MODE_HINTS[m]}
                onClick={() => changeMode(m)}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
          {!agentMode && (
            <button
              className={`attach-toggle${attachPage ? ' on' : ''}`}
              onClick={togglePageAttach}
              title={
                attachPage
                  ? `Attaching ${activeTab?.title ? `“${activeTab.title}”` : 'the current page'} — click to stop`
                  : 'Attach the current page (or your selected text) to this message'
              }
            >
              <span className="attach-dot" />
              <span className="attach-label">Page</span>
            </button>
          )}
          <button className="model-label" title="Change provider or model" onClick={() => setView('settings')}>
            {PROVIDER_LABELS[settings.provider]} · {activeModel(settings)}
          </button>
          {streaming ? (
            <>
              {(input.trim() || files.some((f) => f.status === 'ready')) && (
                <button
                  className="send-button queue-send"
                  onClick={() => enqueue(input)}
                  title={agentMode ? 'Queue — LLMRaki reads it before its next step (Enter)' : 'Queue — sent when this reply finishes (Enter)'}
                >
                  ↑
                </button>
              )}
              <button className="send-button stop" onClick={stop} title="Stop">
                ■
              </button>
            </>
          ) : (
            <button
              className="send-button"
              onClick={() => void send(input)}
              disabled={!input.trim() && !files.some((f) => f.status === 'ready')}
              title="Send (Enter)"
            >
              ↑
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

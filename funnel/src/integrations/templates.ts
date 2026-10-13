// Core email copy: abandoned applications, tier sequences, booking reminders, one-off notes,
// behaviour triggers and the pre-call emails. Written as Bendik, one person to another.
// Rules: no exclamation marks, no hype, no promised outcomes, no invented proof. Every dossier
// field may be empty, so every line that quotes the application has a fallback.
// Never write "guarantee" in the same paragraph as revenue, profit, sales, growth, leads, ROI or
// results: the outcome-promise check reads that as a promise.

import { BREAKOUT, RESOURCES } from "../config";
import { escHtml } from "../lib/text";
import type { EmailCtx, Template } from "./email-types";

type C = EmailCtx;
type Para = string | false | null | undefined | "";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Greeting first, then the non-empty body paragraphs. */
function body(c: C, ...paras: Para[]): string[] {
  return [`Hi ${c.firstName},`, ...paras.filter((p): p is string => typeof p === "string" && p.length > 0)];
}

/** "me" when the closer is the sender, otherwise the closer's name. */
function closer(c: C): string {
  return !c.closerName || c.closerName === c.sigName ? "me" : c.closerName;
}
function withCloser(c: C): string {
  return closer(c) === "me" ? "with me" : `with ${c.closerName}`;
}
function callOn(c: C): string {
  return c.callTime ? `our call on ${c.callTime}` : "our call";
}
function callAt(c: C): string {
  return c.callTime ? `on ${c.callTime}` : "at the time you picked";
}

/** "your practice" / "your business". */
function yours(c: C): string {
  return c.d.industry ? `your ${c.d.industry.one}` : "your business";
}

/** A short quote of what they sell, or "". */
function bizQuote(c: C): string {
  return c.d.business ? `You described the business as &ldquo;${c.d.business}&rdquo;.` : "";
}

const GOAL_LINE: Record<string, string> = {
  own_growth: "a growth machine you own: pages, ads and tracking",
  cut_costs: "cutting what you spend on agencies and software",
  internal_tools: "internal tools and dashboards",
};
function goalPhrase(c: C): string {
  return c.d.goal ? GOAL_LINE[c.d.goal.value] || "" : "";
}
function goalLine(c: C): string {
  const g = goalPhrase(c);
  return g ? `You said what matters most right now is ${g}.` : "";
}

const TIMELINE_LINE: Record<string, string> = {
  "0_3": "You said you'd like this running in the next three months.",
  "3_6": "You said three to six months feels right for this.",
  "6_plus": "You said this is more of a six-months-out project.",
  exploring: "You said you're exploring for now, which is a sensible place to start.",
};
function timelineLine(c: C): string {
  return c.d.timeline ? TIMELINE_LINE[c.d.timeline.value] || "" : "";
}

const BLOCKER_PHRASE: Record<string, string> = {
  dev_capacity: "having no one to build it",
  agency_lockin: "being tied into an agency or retainer",
  tracking: "tracking you can't trust",
  tool_sprawl: "too many tools that don't talk to each other",
  time: "not having the time to lead it",
  ai_doubt: "doubt that AI can really do this",
};
function hasBlocker(c: C, v: string): boolean {
  return c.d.blockers.some((b) => b.value === v);
}
function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
function blockersLine(c: C): string {
  const ph = c.d.blockers.map((b) => BLOCKER_PHRASE[b.value]).filter((x): x is string => !!x);
  return ph.length ? `You mentioned what has held you back so far: ${joinAnd(ph.slice(0, 3))}.` : "";
}

/** "Most dental practices rent the marketing agency and the booking widget." or a generic line. */
function rentLine(c: C): string {
  return c.d.industry
    ? `Most ${c.d.industry.many} I speak to rent ${c.d.industry.rent}, and a few other pieces besides.`
    : "Most founders I speak to rent an agency for ads, a tool for pages, another for tracking and someone to build the reports.";
}

function spendLine(c: C): string {
  return c.d.spend
    ? `You put your yearly spend on agencies, freelancers and software at ${c.d.spend.label}.`
    : "";
}

function firstBuildLine(c: C): string {
  return c.d.firstBuild
    ? `With spend ${c.d.firstBuild.spendLabel} a year, a sensible first build might be ${c.d.firstBuild.build}. That is illustrative, not advice, and we would shape it together.`
    : "";
}

function whyNowLine(c: C): string {
  return c.d.whyNow ? `You wrote that this matters now because &ldquo;${c.d.whyNow}&rdquo;. I'll keep that in mind.` : "";
}

/**
 * One-click links (/go/confirm, /go/requalify) only work once email.ts pre-signs the path; until then ctx.link()
 * falls back to the home page, so use a page that carries the same button instead.
 */
function oneClick(c: C, path: string, fallback: string): string {
  return c.link(path) !== c.link("/") ? path : fallback;
}

const prepList = BREAKOUT.prep.map((p) => escHtml(p.charAt(0).toLowerCase() + p.slice(1).replace(/\.$/, "")));
const resourceTitle = (i: number) => escHtml(RESOURCES[i]?.title || "the resources page");

// ── Abandoned application ─────────────────────────────────────────────────────

const ab: Record<string, Template> = {
  ab_1: (c) => ({
    subject: "Your Asymmetrical application is half done",
    preheader: "It saved as you went. The rest takes about three minutes.",
    paragraphs: body(c,
      "You started an application for Asymmetrical and stopped partway through. That happens. Phones ring and meetings start.",
      "It saved as you went, so you can pick up where you left off. The rest takes about three minutes.",
      "I read every application myself. It is how I decide whether a call would be worth your time, so there is no point dressing anything up.",
    ),
    cta: { label: "Finish your application", path: "/apply" },
  }),
  ab_2: (c) => ({
    subject: "Why the application asks what it asks",
    preheader: "Every question is there to save you a wasted call.",
    paragraphs: body(c,
      "A quick word on the questions in the application, in case any of them gave you pause.",
      "I ask what you sell, roughly what you spend on agencies and software, and what matters most right now. That tells me whether the eight weeks would pay for the effort, or whether you would be better off doing something else.",
      "Rough numbers are fine. Nobody checks them against your accounts, and there are no wrong answers.",
      "If something in there didn't make sense, reply and tell me. I'd like to fix it.",
    ),
    cta: { label: "Pick up your application", path: "/apply" },
  }),
  ab_3: (c) => ({
    subject: "What happens after you press submit",
    preheader: "A straight answer either way.",
    paragraphs: body(c,
      "If you finish the application, here is what happens next.",
      "If it looks like a fit, you will see a calendar and can pick a time for a strategy call. If it doesn't look like a fit yet, I'll tell you so and point you to material that is useful anyway.",
      "Either way you get a straight answer, and nobody chases you with a pitch you didn't ask for.",
    ),
    cta: { label: "Finish the last few questions", path: "/apply" },
  }),
  ab_4: (c) => ({
    subject: "Who the eight-week program is built for",
    preheader: "And who it is not for.",
    paragraphs: body(c,
      "Asymmetrical is built for founders and owners of businesses doing $1M or more a year, who spend real money on agencies, freelancers or software they don't own.",
      "It also needs one person, you or someone on your team, who can give it three to four hours a week for eight weeks. It is done with you, not done for you.",
      "It is not for anyone who wants a promised revenue number. I can't honestly give you one, and I'd be wary of anyone who did.",
      "If that sounds like you, the application is still where you left it.",
    ),
    cta: { label: "Continue where you stopped", path: "/apply" },
  }),
  ab_5: (c) => ({
    subject: "Closing the loop on your Asymmetrical application",
    preheader: "This is the last note about it.",
    paragraphs: body(c,
      "This is the last note I'll send about your unfinished application.",
      "If the timing is wrong, that is completely fine. The application stays open, and you can come back to it whenever it makes sense.",
      "If something put you off, I'd value a one-line reply telling me what it was. I read those too.",
    ),
    cta: { label: "Return to the application", path: "/apply" },
  }),
};

// ── Tier A: get booked ────────────────────────────────────────────────────────

const ta: Record<string, Template> = {
  ta_1: (c) => ({
    subject: "Application received, and a call makes sense",
    preheader: "The next step is a strategy call.",
    paragraphs: body(c,
      "Thanks for applying. I've read your application, and it looks like a good fit for a strategy call " + withCloser(c) + ".",
      bizQuote(c),
      goalLine(c),
      "On the call we look at what you rent today, what your team could own instead, and whether the eight weeks make sense for you. Price is covered there too, once we know the scope.",
      "There is no charge for the call, and nothing is sold on it unless it fits.",
    ),
    cta: { label: "Choose a time for the call", path: c.bookPath },
  }),
  ta_2: (c) => ({
    subject: "How much of your week this really takes",
    preheader: "Three to four hours, one person, eight weeks.",
    paragraphs: body(c,
      "The question I hear most from founders is about time, so here is the plain answer.",
      "It takes three to four hours a week from you or the person who will own the machine, for eight weeks. Less after that.",
      hasBlocker(c, "time")
        ? "You mentioned not having the time to lead it. That is common, and it is why the right person is often not the founder. We can talk about who on your team it should be."
        : "It does not need to be you. Often it works better with one curious person on your team who will sit in the sessions and keep going between them.",
      "If time is the thing that worries you, bring it up on the call and we'll be honest about whether it fits your week.",
    ),
    cta: { label: "Book your strategy call", path: c.bookPath },
  }),
  ta_3: (c) => ({
    subject: "On price, before we speak",
    preheader: "Why the number comes on the call, not before.",
    paragraphs: body(c,
      "You may be wondering why there is no price on the website.",
      "It depends on how much we build and how much of it we do for you. Quoting before I know the scope would mean guessing, and I'd rather give you a real number.",
      spendLine(c),
      "What I can say now: the call has no charge, and you will hear the price on it in plain terms, with time to think.",
    ),
    cta: { label: "Pick a time to talk", path: c.bookPath },
  }),
  ta_4: (c) => ({
    subject: "Can Claude Code really build this",
    preheader: "A fair question. Here is an honest answer.",
    paragraphs: body(c,
      hasBlocker(c, "ai_doubt")
        ? "You said you're not sure AI can do this. That is a fair doubt, so let me answer it directly."
        : "A fair question many founders ask is whether AI can really build a working growth system.",
      "Claude Code is a tool that writes and changes software from plain-English instructions. It is very good at that. It does not know your business, your customers or what good looks like for you.",
      "That is why the program is done with you. Your team brings the judgement, Claude Code does the heavy typing, and we sit beside you each week until your people are confident.",
      "If you want to see it rather than read about it, the call is a good place to ask.",
    ),
    cta: { label: "Book a call to see it", path: c.bookPath },
  }),
  ta_5: (c) => ({
    subject: "Leaving a retainer without breaking anything",
    preheader: "You don't have to switch everything off on day one.",
    paragraphs: body(c,
      rentLine(c),
      hasBlocker(c, "agency_lockin")
        ? "You mentioned being tied into an agency or retainer. Nobody is asking you to cancel anything on day one."
        : "If you work with an agency today, nobody is asking you to cancel anything on day one.",
      "The usual pattern is to build your own pieces alongside what you have, check they work, and only then decide what to stop paying for. Your contracts, your timing.",
      "We can map that out on the call, piece by piece.",
    ),
    cta: { label: "Book the strategy call", path: c.bookPath },
  }),
  ta_6: (c) => ({
    subject: "Why the ad numbers rarely match the bank",
    preheader: "A short note about tracking.",
    paragraphs: body(c,
      hasBlocker(c, "tracking")
        ? "You mentioned tracking you can't trust. You're in good company, and it is usually fixable."
        : "A short note about tracking, because it quietly shapes every ad decision.",
      "The Meta Pixel runs in the browser. Ad blockers, privacy settings and declined cookies all hide some of what happens, so Meta sees part of the picture and optimises for that part.",
      "Server-side tracking with the Conversions API sends the important events from your own server, deduplicated, with a value for qualified leads. Meta then learns from the people who actually matter to you.",
      "In the program your team sets this up and understands it, so it doesn't break the day someone leaves.",
    ),
    cta: { label: "Talk tracking on a call", path: c.bookPath },
  }),
  ta_7: (c) => ({
    subject: "Whose name is on the accounts",
    preheader: "Your domain, your code, your data.",
    paragraphs: body(c,
      "One thing worth checking with any supplier: whose name is on the accounts.",
      "With us, everything runs on yours. Your domain, your Cloudflare account, your ad account, your code. We never hold your data hostage.",
      "If you stop working with us tomorrow, everything keeps running, and your team knows how to change it. That is the whole point of owning it.",
    ),
    cta: { label: "Book your call", path: c.bookPath },
  }),
  ta_8: (c) => ({
    subject: "The two promises we make, in plain words",
    preheader: "And the one we never make.",
    paragraphs: body(c,
      "This is my last note in this run, so I'll end with the two promises we make.",
      "First, a seven-day money-back guarantee from your start date. If it is not for you, tell us and you get your money back.",
      "Second, a delivery guarantee. If your VSL page, tracking and dashboard are not live by the end of week eight, we keep working with you at no extra cost until they are, as long as you attend the weekly sessions.",
      "What I won't promise is a revenue number. What the machine produces depends on your offer, your market and your team.",
      "If you would like to talk it through, the calendar is open.",
    ),
    cta: { label: "Choose a time", path: c.bookPath },
  }),
};

// ── Tier B: softer, breakout first ────────────────────────────────────────────

const tb: Record<string, Template> = {
  tb_1: (c) => ({
    subject: "Thanks for applying. One short video first",
    preheader: "Five minutes that answer the usual questions.",
    paragraphs: body(c,
      "Thanks for your application. I've read it.",
      bizQuote(c),
      "Before we talk, there is a short video that answers what most founders ask first: what it costs, how much time it takes, and what to bring to a call.",
      "Watch it when you have five minutes. If it still makes sense afterwards, you can pick a time on the same page.",
    ),
    cta: { label: "Watch the short video", path: "/breakout" },
  }),
  tb_2: (c) => ({
    subject: "What the strategy call is, and what it is not",
    preheader: "No pitch you didn't ask for.",
    paragraphs: body(c,
      "A word on the strategy call, so you know what you would be agreeing to.",
      "It is a conversation about your business: what you rent today, what your team could own instead, and whether eight weeks of building together makes sense.",
      "It is not a pitch you have to sit through. If it isn't a fit, I'll say so, and you leave with a clearer picture either way.",
    ),
    cta: { label: "See what the call covers", path: "/breakout" },
  }),
  tb_3: (c) => ({
    subject: "If now is not quite the moment",
    preheader: "Timing matters. So does knowing your options.",
    paragraphs: body(c,
      timelineLine(c) || "Timing is often the real question with something like this.",
      "That is fine. Plenty of founders talk to us months before they start, simply to understand what owning their growth stack would involve.",
      "A call now commits you to nothing. It just means that when the timing is right, you already know the shape of it.",
    ),
    cta: { label: "Watch the five-minute video", path: "/breakout" },
  }),
  tb_4: (c) => ({
    subject: "When someone else signs off",
    preheader: "Bring them along.",
    paragraphs: body(c,
      "Decisions like this are often not made by one person. A partner, a co-founder or a board usually has a say.",
      "If that is true for you, bring them to the call. It saves you explaining it twice, and they can ask their own questions.",
      "The short video is a good thing to share with them beforehand.",
    ),
    cta: { label: "Open the video page", path: "/breakout" },
  }),
  tb_5: (c) => ({
    subject: "Starting smaller is allowed",
    preheader: "You don't have to build everything at once.",
    paragraphs: body(c,
      "Working with us doesn't have to mean building everything at once.",
      firstBuildLine(c) || "Some teams start with one page and its application, plus tracking they can trust, and add the rest once that works. Illustrative, not advice; we'd shape it together.",
      "The point is that whatever you build, your team owns it and knows how to change it.",
      "If a smaller start sounds more like you, say so on the call.",
    ),
    cta: { label: "Choose a time", path: c.bookPath },
  }),
  tb_6: (c) => ({
    subject: "What your team actually learns",
    preheader: "The skill stays after we leave.",
    paragraphs: body(c,
      "The pages, the tracking and the dashboard matter. What matters more is what your team can do afterwards.",
      "Each week we sit with your people while they build. By week eight they ship a change on their own, and we review it with them.",
      "That skill stays in " + yours(c) + ". The next tool you need, you build, instead of starting another search for someone to rent.",
    ),
    cta: { label: "Book a strategy call", path: c.bookPath },
  }),
  tb_7: (c) => ({
    subject: "A question worth answering before any call",
    preheader: "What do you rent today, and what does it cost?",
    paragraphs: body(c,
      "Here is an exercise that is useful whether or not we ever speak.",
      "List everything you pay for each month to get customers: the agency, the page builder, the tracking tool, the reporting, the freelancer. Then add it up for a year.",
      spendLine(c) || "Most founders find the total higher than they expected.",
      "Then ask which of those you would own if you stopped paying tomorrow. That answer is usually what the call is about.",
    ),
    cta: { label: "Talk it through on a call", path: c.bookPath },
  }),
  tb_8: (c) => ({
    subject: "Leaving the door open on Asymmetrical",
    preheader: "No more notes in this run.",
    paragraphs: body(c,
      "This is my last note for now about booking a call.",
      "If it isn't the right time, that is fine. Nothing expires, and there is no countdown.",
      "If it is the right time, the video and the calendar are where they were.",
    ),
    cta: { label: "Go to the call page", path: c.bookPath },
  }),
};

// ── Tier C: resources, no hard sell ───────────────────────────────────────────

const tc: Record<string, Template> = {
  tc_1: (c) => ({
    subject: "About your application, honestly",
    preheader: "Not a fit yet, and why that is fine.",
    paragraphs: body(c,
      "Thank you for applying. I read your application, and I'll be straight with you: the program isn't the right fit yet.",
      "The program is built for owners of businesses doing $1M or more a year, with enough spend on agencies and software that owning it instead pays for the effort. Before that point there are better uses of your time and money.",
      "I've put together a few resources that are useful at any stage. They cost nothing and there is no pitch at the end of them.",
    ),
    cta: { label: "Open the resources", path: "/resources" },
  }),
  tc_2: (c) => ({
    subject: "A worksheet for what you rent today",
    preheader: "One page, ten minutes.",
    paragraphs: body(c,
      `The first resource worth ten minutes is ${resourceTitle(0)}.`,
      "It is a one-page worksheet. You list every tool, agency and freelancer you pay to get customers, and what each costs a year.",
      "Most people find at least one thing they forgot they were paying for. Either way, you end up knowing your real cost of getting customers, which helps every decision after it.",
    ),
    cta: { label: "Get the worksheet", path: "/resources" },
  }),
  tc_3: (c) => ({
    subject: "Tracking you can check yourself",
    preheader: "Why the Pixel alone misses things.",
    paragraphs: body(c,
      `Next on the list is ${resourceTitle(1)}.`,
      "If you run any ads, it explains why the browser Pixel misses part of what happens and what the Conversions API changes.",
      "Even if you don't build anything yourself, it helps you ask better questions of whoever runs your ads.",
    ),
    cta: { label: "Read the tracking guide", path: "/resources" },
  }),
  tc_4: (c) => ({
    subject: "Thirty minutes with Claude Code",
    preheader: "Build a small internal tool yourself.",
    paragraphs: body(c,
      `The third resource is ${resourceTitle(2)}.`,
      "It walks you through building a small internal tool in about thirty minutes. No programming background needed, just a problem you'd like to stop doing by hand.",
      "It is the quickest way I know to find out whether this way of working suits you.",
    ),
    cta: { label: "Try the walkthrough", path: "/resources" },
  }),
  tc_5: (c) => ({
    subject: "One weekly habit worth more than any tool",
    preheader: "Fifteen minutes on a Monday.",
    paragraphs: body(c,
      "Something simple that helps at any size: a fifteen-minute numbers review once a week.",
      "Write down how many people enquired, how many you spoke to, how many bought and what you spent to reach them. Same four numbers, same day, every week.",
      "After a couple of months you will see patterns no dashboard shows you, because you were paying attention.",
    ),
    cta: { label: "More resources", path: "/resources" },
  }),
  tc_6: (c) => ({
    subject: "When things change, the door is open",
    preheader: "Apply again whenever it makes sense.",
    paragraphs: body(c,
      "This is the last note in this series.",
      "If " + yours(c) + " grows past $1M a year, or you start spending real money on agencies and software, Asymmetrical may well make sense then.",
      "When that day comes, apply again. I'll read it with fresh eyes.",
      `If something has already changed, ${c.a(oneClick(c, "/go/requalify", "/apply"), "update your answers here")}. Everything you told us is kept, so it takes a minute.`,
    ),
    cta: { label: "Apply again later", path: "/apply" },
  }),
};

// ── Booked: confirmation and reminders ────────────────────────────────────────

function joinLine(c: C): string {
  return `When it is time, ${c.a("/go/join", "join the call here")}. If the time no longer works, you can ${c.a("/go/reschedule", "reschedule here")}.`;
}

const bk: Record<string, Template> = {
  bk_confirm: (c) => ({
    subject: "Confirmed: your strategy call",
    preheader: "The time, what to prepare and a short video.",
    paragraphs: body(c,
      `You're booked. Our call is ${callAt(c)}, ${withCloser(c)}.`,
      `To get the most from it, it helps to ${joinAnd(prepList)}.`,
      `There is a short pre-call video on ${c.a("/breakout", "the pre-call page")}. It explains how the call runs, so we can spend the time on your business.`,
      joinLine(c),
    ),
    cta: { label: "Watch the pre-call video", path: "/breakout" },
  }),
  bk_48h: (c) => ({
    subject: "Two days until we talk",
    preheader: "A quick reminder and one thing to think about.",
    paragraphs: body(c,
      `A reminder that ${callOn(c)} is two days away.`,
      "If you have a moment before then, jot down roughly what you spend a year on agencies, freelancers and software. A rough number is enough.",
      joinLine(c),
    ),
  }),
  bk_24h: (c) => ({
    subject: "Tomorrow's call, and one thing to bring",
    preheader: "Bring whoever signs off on decisions like this.",
    paragraphs: body(c,
      `Looking forward to ${callOn(c)}.`,
      "If anyone else signs off on decisions like this, a partner or co-founder, it is worth asking them to join.",
      "If you can, tap the button below so I know to expect you. It takes one second.",
      joinLine(c),
    ),
    cta: { label: "I'll be there", path: oneClick(c, "/go/confirm", "/breakout") },
  }),
  // Two hours before, only for people who have not confirmed (see SEQUENCES.booked).
  bk_2h: (c) => ({
    subject: "Still good for our call today?",
    preheader: "One tap to confirm, or move it.",
    paragraphs: body(c,
      `${c.callTime ? `Our call on ${c.callTime}` : "Our call"} is in about two hours.`,
      "Could you let me know you're still coming? One tap on the button below is enough.",
      joinLine(c),
    ),
    cta: { label: "I'll be there", path: oneClick(c, "/go/confirm", "/breakout") },
  }),
  bk_3h: (c) => ({
    subject: "Later today: our strategy call",
    preheader: "The link is below.",
    paragraphs: body(c,
      `A short note that ${callOn(c)} is later today.`,
      "If you can, find a quiet spot with your ad account and analytics logins to hand, in case we want to look at something together.",
      joinLine(c),
    ),
  }),
  bk_1h: (c) => ({
    subject: "We speak in about an hour",
    preheader: "The join link is below.",
    paragraphs: body(c,
      `${c.callTime ? `Our call on ${c.callTime}` : "Our call"} starts in about an hour.`,
      `Here is the link: ${c.a("/go/join", "Join the call")}.`,
      `If something has come up, no problem, you can ${c.a("/go/reschedule", "reschedule here")}.`,
    ),
    cta: { label: "Join the call", path: "/go/join" },
  }),
  bk_10m: (c) => ({
    subject: "Starting in ten minutes",
    preheader: "See you shortly.",
    paragraphs: body(c,
      `${c.callTime ? `Our call on ${c.callTime}` : "Our call"} starts in about ten minutes.`,
      `${c.a("/go/join", "Join the call")} whenever you're ready. I'll be there.`,
      `If you're running late or can't make it, ${c.a("/go/reschedule", "reschedule here")}.`,
    ),
    cta: { label: "Join the call", path: "/go/join" },
  }),
};

// ── One-off notes ─────────────────────────────────────────────────────────────

const misc: Record<string, Template> = {
  continue_link: (c) => ({
    subject: "Continue your Asymmetrical application",
    preheader: "Your link to pick up where you left off.",
    paragraphs: body(c,
      "Someone, probably you, just started an application with this email address on a new browser.",
      `To pick up where you left off, use this link: ${c.a("/apply", "Continue your application")}.`,
      "If that wasn't you, you can ignore this email. Nothing changes without the link.",
    ),
    cta: { label: "Continue your application", path: "/apply" },
  }),
  voice_link_book: (c) => ({
    subject: "The booking link from your call with Sam",
    preheader: "Pick a time that suits you.",
    paragraphs: body(c,
      "Thanks for taking the call from Sam, our AI assistant. You asked for the booking link, so here it is.",
      `You can ${c.a(c.bookPath, "choose a time here")}. Pick whatever suits your week.`,
      "If you have questions before then, reply to this email and I'll answer.",
    ),
    cta: { label: "Choose a time", path: c.bookPath },
  }),
  voice_link_reschedule: (c) => ({
    subject: "Your link to move the strategy call",
    preheader: "Choose a new time.",
    paragraphs: body(c,
      "Thanks for letting Sam, our AI assistant, know the time doesn't work. You asked for a link to move the call.",
      `You can ${c.a("/go/reschedule", "reschedule here")} and pick a time that suits you better.`,
      "No need to explain. These things happen.",
    ),
    cta: { label: "Pick a new time", path: "/go/reschedule" },
  }),
  test_email: (c) => ({
    subject: "Test email from Funnel HQ",
    preheader: "If you can read this, sending works.",
    paragraphs: body(c,
      "This is a test email sent from the Integrations page.",
      "If you can read this, the email connection works, links are signed and the footer renders.",
      `Here is a sample link to check tracking: ${c.a("/", "the home page")}.`,
    ),
    cta: { label: "Open the site", path: "/" },
  }),
};

// ── Behaviour triggers (each fires once per lead) ─────────────────────────────

const triggers: Record<string, Template> = {
  t_vsl_no_apply: (c) => ({
    subject: "What happens after the film",
    preheader: "The application, and why it exists.",
    paragraphs: body(c,
      "A short note on what comes after the film, if you're weighing it up.",
      "The next step is an application. It takes about three minutes and asks what you sell, roughly what you spend on agencies and software, and what matters most right now.",
      "I read every one. If it looks like a fit you can book a strategy call straight away. If not, I'll tell you and point you to something useful instead.",
    ),
    cta: { label: "Start your application", path: "/apply" },
  }),
  t_stalled: (c) => ({
    subject: "Picking the application back up",
    preheader: "It saves as you go.",
    paragraphs: body(c,
      "Applications save as you go, so if yours got interrupted, it is still there.",
      "The remaining questions are short. Rough answers are fine, and none of them are traps.",
      "If one of the questions was unclear, reply and tell me which. It helps me make it better.",
    ),
    cta: { label: "Pick up your application", path: "/apply" },
  }),
  t_finish_booking: (c) => ({
    subject: "One step left to confirm a time",
    preheader: "The calendar only holds a time once it's confirmed.",
    paragraphs: body(c,
      "A small thing about the calendar: a time is only held once the booking is confirmed on the last screen.",
      "If you were choosing a slot and got pulled away, it takes under a minute to finish.",
      `You can ${c.a(c.bookPath, "pick a time here")} whenever suits you.`,
    ),
    cta: { label: "Confirm a time", path: c.bookPath },
  }),
  t_came_back: (c) => ({
    subject: "Your place for a strategy call is still open",
    preheader: "Whenever you're ready.",
    paragraphs: body(c,
      "A quick note to say your application still stands, and you can book a strategy call " + withCloser(c) + " whenever it suits.",
      goalLine(c) || bizQuote(c),
      "If there is a question holding you back, reply with it. I'd rather answer it by email than have you guess.",
    ),
    cta: { label: "Choose a time", path: c.bookPath },
  }),
  t_still_thinking: (c) => ({
    subject: "Thinking it over is reasonable",
    preheader: "Three questions that usually settle it.",
    paragraphs: body(c,
      "Taking time over a decision like this is sensible. Here are three questions that tend to settle it for founders.",
      "What do you pay each year for growth you don't own? Who on your team could give this three to four hours a week? And what would you build first if you could?",
      "If you have answers, a call is a good next step. If you don't yet, the call can help you find them, with no obligation either way.",
    ),
    cta: { label: "Book a time to talk", path: c.bookPath },
  }),
  t_guarantee: (c) => ({
    subject: "How the money-back guarantee works",
    preheader: "Two promises, stated plainly.",
    paragraphs: body(c,
      "People often ask how our guarantee works, so here it is in plain words.",
      "You have seven days from your start date. If it is not for you, tell us and you get your money back. No forms to fight through.",
      "There is also a delivery guarantee. If your VSL page, tracking and dashboard are not live by the end of week eight, we keep working with you at no extra cost until they are, as long as you attend the weekly sessions.",
      "Neither of those is a promise about what the machine will earn you. That depends on your offer and your market, and I won't pretend otherwise.",
    ),
    cta: { label: "Talk it through on a call", path: c.bookPath },
  }),
  t_cost: (c) => ({
    subject: "Why there is no price on the website",
    preheader: "And how we handle it on the call.",
    paragraphs: body(c,
      "A word on cost, since it is the first thing most founders want to know.",
      "There is no price on the website because it depends on how much we build and how much of it we do for you. A number without the scope would be a guess.",
      "On the call you'll hear the price plainly, once we both understand what you need. There is no charge for the call, and nothing is sold on it unless it fits.",
      spendLine(c) ? spendLine(c) + " That helps us compare it with what you pay today." : "",
    ),
    cta: { label: "Book a strategy call", path: c.bookPath },
  }),
  t_book_nudge: (c) => ({
    subject: "Choosing a call time that suits you",
    preheader: "Early, late, whatever fits your week.",
    paragraphs: body(c,
      "If finding a time for a strategy call is the hard part, a couple of things that might help.",
      "Pick whatever suits you, early or late. If it later clashes with something, rescheduling takes one click.",
      "And if you'd rather ask a question first, reply to this email. It comes straight to me.",
    ),
    cta: { label: "See available times", path: c.bookPath },
  }),
  t_breakout_done: (c) => ({
    subject: "The next step after the short video",
    preheader: "If it made sense, here is where to go.",
    paragraphs: body(c,
      "The short video covers cost, time and what to bring. If it answered your questions, the next step is simply to pick a time.",
      "If it raised new questions, those are exactly what the call is for. Bring them.",
      timelineLine(c),
    ),
    cta: { label: "Pick a time", path: c.bookPath },
  }),
  t_watch_prep: (c) => ({
    subject: "Five minutes before we speak",
    preheader: "A short video that makes the call more useful.",
    paragraphs: body(c,
      `Before ${callOn(c)}, there is a short video on ${c.a("/breakout", "the pre-call page")}.`,
      "It takes about five minutes and covers how the call runs and what is worth having to hand. It means we can spend our time on your business rather than on the basics.",
      "If you only have time for one thing beforehand, make it this.",
    ),
    cta: { label: "Watch the pre-call video", path: "/breakout" },
  }),
};

// ── Pre-call general emails, one pain point each ──────────────────────────────

const PRE = { label: "Open the pre-call page", path: "/breakout" };

const pc: Record<string, Template> = {
  pc_rent: (c) => ({
    subject: "Renting growth versus owning it",
    preheader: "The difference shows up when you stop paying.",
    paragraphs: body(c,
      "Something to think about before " + callOn(c) + ".",
      rentLine(c),
      "Rent is fine for a while. The trouble is what you have when you stop paying: usually nothing. The pages, the data and the know-how leave with the supplier.",
      "Owning it means the machine stays, and the people who run it are yours.",
    ),
    cta: PRE,
  }),
  pc_agency: (c) => ({
    subject: "What a monthly retainer actually buys",
    preheader: "Time from someone else's team.",
    paragraphs: body(c,
      "A retainer buys you time from someone else's team. That can be good value, especially early on.",
      "What it rarely buys is anything you keep. When the retainer ends, so does the work, and the knowledge of how it was done.",
      hasBlocker(c, "agency_lockin") ? "You mentioned being tied into one. On the call we can look at how to build alongside it, without breaking anything." : "On the call we can look at which parts are worth keeping and which you'd rather own.",
    ),
    cta: PRE,
  }),
  pc_saas: (c) => ({
    subject: "Counting the logins",
    preheader: "Tool sprawl adds up quietly.",
    paragraphs: body(c,
      "Try counting how many logins your team uses to get and follow up with customers. Page builder, forms, email tool, scheduling, tracking, reporting.",
      "Each one made sense on its own. Together they rarely talk to each other, and every monthly fee keeps running.",
      hasBlocker(c, "tool_sprawl") ? "You mentioned this one yourself, so it'll be worth a few minutes on the call." : "If that sounds familiar, it'll be worth a few minutes on the call.",
    ),
    cta: PRE,
  }),
  pc_pixel: (c) => ({
    subject: "Why the Pixel misses conversions",
    preheader: "The browser doesn't see everything.",
    paragraphs: body(c,
      "The Meta Pixel lives in the visitor's browser. Ad blockers, privacy settings, declined cookies and closed tabs all stop some events from arriving.",
      "So Meta sees part of what happened and optimises for that part. How big the gap is varies a lot between businesses.",
      "The practical effect is that ad decisions get made on incomplete numbers, which is worth knowing before anyone tells you a campaign is working or not.",
    ),
    cta: PRE,
  }),
  pc_capi: (c) => ({
    subject: "What the Conversions API changes",
    preheader: "Events from your server, not the browser.",
    paragraphs: body(c,
      "The Conversions API sends events to Meta from your own server, not the visitor's browser.",
      "Done properly it is deduplicated against the Pixel, so nothing is counted twice, and it can carry a value for a qualified lead. That lets Meta learn which people are worth finding more of.",
      "It isn't magic. It is plumbing, and in the program your team sets it up and understands it.",
    ),
    cta: PRE,
  }),
  pc_vsl: (c) => ({
    subject: "Why a video page and an application",
    preheader: "Let people decide before they talk to you.",
    paragraphs: body(c,
      "A VSL page is a page built around one video that explains your offer properly, followed by an application.",
      "The video does the explaining you would otherwise repeat on every call. The application lets people tell you about themselves before you spend time with them.",
      "The result is fewer calls with people who were never going to buy, and better calls with the ones who might.",
    ),
    cta: PRE,
  }),
  pc_application: (c) => ({
    subject: "Scoring every applicant the same way",
    preheader: "Routing by fit, not by gut feel.",
    paragraphs: body(c,
      "An application is only useful if something happens with the answers.",
      "In the machine your team builds, each answer carries points. The total decides where someone goes next: a calendar, a short video first, or useful resources if it isn't a fit yet.",
      "It means every applicant is treated consistently, and your team's time goes where it matters most. You set the rules, and you can change them.",
    ),
    cta: PRE,
  }),
  pc_speed: (c) => ({
    subject: "The first hour after someone applies",
    preheader: "Interest cools quickly.",
    paragraphs: body(c,
      "When someone applies, they are thinking about you right then. A day later they are thinking about something else.",
      "That is why the system replies within minutes: a confirmation, a next step, and where it makes sense, a call from our assistant to offer a time.",
      "None of it relies on someone remembering to check an inbox. That is the part most businesses quietly lose.",
    ),
    cta: PRE,
  }),
  pc_followup: (c) => ({
    subject: "Follow-up that remembers what they said",
    preheader: "Emails that quote the application.",
    paragraphs: body(c,
      "Most follow-up emails could be sent to anyone. People notice.",
      "Follow-up that reads the application can refer back to what the person actually told you: what they sell, what they want, what has held them back.",
      "It is sent on time without anyone remembering, and it stops the moment they book. Your team writes the words; the system does the sending.",
    ),
    cta: PRE,
  }),
  pc_dashboard: (c) => ({
    subject: "One screen from click to cash",
    preheader: "Every step in one place.",
    paragraphs: body(c,
      "Imagine one screen that shows every visitor, application, call and close, and where each one came from.",
      "Show rate, close rate and cash by rep, without anyone stitching together exports on a Friday afternoon.",
      "That is what the dashboard in the program is for. Your team builds it, so when you want a new number, they add it.",
    ),
    cta: PRE,
  }),
  pc_no_dev: (c) => ({
    subject: "No developers on the payroll",
    preheader: "One curious person is enough.",
    paragraphs: body(c,
      hasBlocker(c, "dev_capacity") ? "You mentioned having no one to build it. That is the most common reason founders give, and it is why this program exists." : "A common assumption is that building your own systems needs a development team.",
      "It doesn't any more. Claude Code does the heavy lifting. What you need is one curious person who will sit in the weekly sessions and keep going between them.",
      "They don't need to write code. They need to know what good looks like for " + yours(c) + ", and to be willing to try things.",
    ),
    cta: PRE,
  }),
  pc_claude_code: (c) => ({
    subject: "What Claude Code is, in plain words",
    preheader: "A tool, not a magic trick.",
    paragraphs: body(c,
      "Claude Code is a tool made by Anthropic that writes and changes software when you describe what you want in plain English.",
      "Your team asks for a page, a report or a fix. It writes the code, explains what it did, and changes it when you ask. A person stays in charge of every decision.",
      "We build on it because it is the best tool for this job. Asymmetrical AI Solutions is an independent company, not affiliated with Anthropic.",
    ),
    cta: PRE,
  }),
  pc_ownership: (c) => ({
    subject: "Your accounts, your code, your data",
    preheader: "Nothing held hostage.",
    paragraphs: body(c,
      "Everything we build in the program runs on your accounts: your domain, your Cloudflare, your ad account.",
      "The code is yours, the data is yours, and your team knows how to change both.",
      "If we stopped working together tomorrow, nothing would switch off. That is a fair test to apply to any supplier.",
    ),
    cta: PRE,
  }),
  pc_team_time: (c) => ({
    subject: "Three to four hours a week, and from whom",
    preheader: "The real time cost.",
    paragraphs: body(c,
      "The honest time cost is three to four hours a week for eight weeks, from you or the person who will own the machine.",
      "That includes a weekly session with us and some building in between. After week eight it drops, because the system runs on its own.",
      "It is worth thinking about who that person is before " + callOn(c) + ". It is often not the founder.",
    ),
    cta: PRE,
  }),
  pc_guarantee: (c) => ({
    subject: "The guarantee, before you hear it on the call",
    preheader: "Two promises, no small print games.",
    paragraphs: body(c,
      "So you have it in writing before we speak, here is how the guarantee works.",
      "Seven days from your start date: if it isn't for you, tell us and you get your money back.",
      "And if your VSL page, tracking and dashboard are not live by the end of week eight, we keep working with you at no extra cost until they are, as long as you attend the weekly sessions.",
    ),
    cta: PRE,
  }),
  pc_agenda: (c) => ({
    subject: "How our call will run",
    preheader: "Three parts, plain and simple.",
    paragraphs: body(c,
      `Here is how ${callOn(c)} will run, so nothing is a surprise.`,
      "First, your business: what you sell, what you rent today and what you want to own. Second, what eight weeks could build for " + yours(c) + ", in plain terms. Third, the price and whether it fits.",
      "If it isn't a fit, I'll say so. If it is, you can take time to think. Nothing is decided on the spot.",
    ),
    cta: PRE,
  }),
  pc_dev_quote: (c) => ({
    subject: "What a dev shop might quote",
    preheader: "Illustrative, not advice.",
    paragraphs: body(c,
      "A rough comparison some founders find useful.",
      "Illustrative, not advice: a development shop asked to build a VSL page with an application, server-side tracking, a sales dashboard and email follow-up might quote somewhere in the tens of thousands of dollars, and then charge again for every change.",
      firstBuildLine(c),
      "The difference here is that your team learns to build and change it, so the next change doesn't come with a new quote.",
    ),
    cta: PRE,
  }),
  pc_ai_doubt: (c) => ({
    subject: "A healthy dose of doubt about AI",
    preheader: "Scepticism is a good starting point.",
    paragraphs: body(c,
      hasBlocker(c, "ai_doubt") ? "You said you're not sure AI can do this. I'd rather work with someone sceptical than someone starry-eyed." : "If you're sceptical about AI, good. I'd rather work with someone sceptical than someone starry-eyed.",
      "There is a lot of noise about it. Some of it is true, much of it isn't. The useful question is narrow: can it reliably build and change the specific things your business needs?",
      "For pages, tracking, dashboards and internal tools, in our experience it can, with a person checking the work. Bring your doubts to the call and test them.",
    ),
    cta: PRE,
  }),
  pc_handover: (c) => ({
    subject: "What week eight looks like",
    preheader: "Your team ships a change on its own.",
    paragraphs: body(c,
      "Week eight is the handover. Your team ships a change on its own, and we review it with them.",
      "By then the VSL page, the tracking, the dashboard and the follow-up are live on your accounts, and your people have built most of it with their own hands.",
      "After that your team runs it. Some founders keep a monthly session with us; most don't need to.",
    ),
    cta: PRE,
  }),
  pc_two_paths: (c) => ({
    subject: "Two paths from here",
    preheader: "Keep renting, or own it.",
    paragraphs: body(c,
      "There are two reasonable paths for " + yours(c) + ".",
      "One is to keep renting: agencies and tools, paid monthly, with someone else holding the know-how. It works, and plenty of businesses do fine that way.",
      "The other is to own it: your team builds the machine once, keeps it, and changes it when they need to.",
      "The call is about working out which path suits you. Either answer is fine.",
    ),
    cta: PRE,
  }),
  pc_next_year: (c) => ({
    subject: "This time next year",
    preheader: "A question worth sitting with.",
    paragraphs: body(c,
      "A question worth sitting with before " + callOn(c) + ": where would you like " + yours(c) + " to be this time next year?",
      goalLine(c),
      "Not a revenue number, necessarily. Which systems you'd like to own, which bills you'd like to stop paying, what your team could do that it can't today.",
      "Bring your answer. It shapes the rest of the conversation.",
    ),
    cta: PRE,
  }),
  pc_if_you_could: (c) => ({
    subject: "If you could change one thing",
    preheader: "Just one.",
    paragraphs: body(c,
      "If you could change one thing about how " + yours(c) + " gets and follows up with customers, what would it be?",
      blockersLine(c),
      "Most founders know the answer straight away. It is usually the thing they've been meaning to fix for a year.",
      "Start the call with that, and we'll work outwards from it.",
    ),
    cta: PRE,
  }),
  pc_waiting: (c) => ({
    subject: "The quiet cost of waiting",
    preheader: "Not a deadline. Just arithmetic.",
    paragraphs: body(c,
      "There is no deadline here, and I won't invent one.",
      whyNowLine(c),
      "But it's worth noticing that rent keeps running while a decision waits. Every month on a retainer or a tool you don't own is a month of paying for something that stays with someone else.",
      "Sometimes waiting is right. The point is to choose it, rather than drift into it.",
    ),
    cta: PRE,
  }),
  pc_questions: (c) => ({
    subject: "Bring your questions to the call",
    preheader: "Write them down as they come.",
    paragraphs: body(c,
      `If questions come up before ${callOn(c)}, write them down as they come.`,
      "Nothing is off limits: price, time, the guarantee, what happens if your best person leaves, what we'd do differently in your industry.",
      "The calls that go best are the ones where people bring the awkward questions. Reply to this email with any you'd like me to think about beforehand.",
    ),
    cta: PRE,
  }),
};

// ── Exports ───────────────────────────────────────────────────────────────────

export const CORE_TEMPLATES: Record<string, Template> = {
  ...ab,
  ...ta,
  ...tb,
  ...tc,
  ...bk,
  ...misc,
  ...triggers,
  ...pc,
};

export const PRECALL_GENERAL: string[] = [
  "pc_rent", "pc_agency", "pc_saas", "pc_pixel", "pc_capi", "pc_vsl", "pc_application", "pc_speed",
  "pc_followup", "pc_dashboard", "pc_no_dev", "pc_claude_code", "pc_ownership", "pc_team_time", "pc_guarantee", "pc_agenda",
  "pc_dev_quote", "pc_ai_doubt", "pc_handover", "pc_two_paths", "pc_next_year", "pc_if_you_could", "pc_waiting", "pc_questions",
];

export const CORE_TOPICS: Record<string, string[]> = {
  ab_1: ["application"],
  ab_2: ["application", "numbers"],
  ab_3: ["application", "call"],
  ab_4: ["application", "offer", "time"],
  ab_5: ["application"],

  ta_1: ["booking", "call", "goal"],
  ta_2: ["time", "booking"],
  ta_3: ["price", "booking"],
  ta_4: ["tech", "trust", "blocker"],
  ta_5: ["agency", "blocker"],
  ta_6: ["tracking", "blocker"],
  ta_7: ["ownership"],
  ta_8: ["guarantee", "results"],

  tb_1: ["call", "booking"],
  tb_2: ["call", "trust"],
  tb_3: ["why_now", "booking"],
  tb_4: ["call", "booking"],
  tb_5: ["offer", "numbers"],
  tb_6: ["after", "offer"],
  tb_7: ["numbers", "tools"],
  tb_8: ["booking"],

  tc_1: ["resources"],
  tc_2: ["resources", "numbers"],
  tc_3: ["resources", "tracking"],
  tc_4: ["resources", "tech"],
  tc_5: ["resources", "numbers"],
  tc_6: ["application"],

  bk_confirm: ["call", "booking"],
  bk_48h: ["call"],
  bk_24h: ["call"],
  bk_2h: ["call"],
  bk_3h: ["call"],
  bk_1h: ["call"],
  bk_10m: ["call"],

  continue_link: ["application"],
  voice_link_book: ["booking"],
  voice_link_reschedule: ["booking", "call"],
  test_email: ["offer"],

  t_vsl_no_apply: ["application", "offer"],
  t_stalled: ["application"],
  t_finish_booking: ["booking"],
  t_came_back: ["booking", "goal"],
  t_still_thinking: ["booking", "time", "numbers"],
  t_guarantee: ["guarantee"],
  t_cost: ["price"],
  t_book_nudge: ["booking"],
  t_breakout_done: ["booking", "call"],
  t_watch_prep: ["call"],

  pc_rent: ["ownership", "agency", "industry"],
  pc_agency: ["agency"],
  pc_saas: ["tools"],
  pc_pixel: ["tracking"],
  pc_capi: ["tracking", "tech"],
  pc_vsl: ["pages"],
  pc_application: ["application", "pages"],
  pc_speed: ["followup"],
  pc_followup: ["followup"],
  pc_dashboard: ["dashboard", "numbers"],
  pc_no_dev: ["tech", "blocker"],
  pc_claude_code: ["tech", "trust"],
  pc_ownership: ["ownership"],
  pc_team_time: ["time"],
  pc_guarantee: ["guarantee"],
  pc_agenda: ["call"],
  pc_dev_quote: ["price", "numbers"],
  pc_ai_doubt: ["tech", "trust", "blocker"],
  pc_handover: ["after"],
  pc_two_paths: ["agency", "ownership"],
  pc_next_year: ["goal", "why_now"],
  pc_if_you_could: ["goal", "blocker"],
  pc_waiting: ["why_now"],
  pc_questions: ["call"],
};

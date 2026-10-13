// Application-specific follow-up emails: pre-call prep, no-show, post-call, cancelled, lost, won and
// nurture. Every template quotes the dossier (already escaped and defanged) and must read sensibly
// when the application is empty. Voice: Bendik writing a short personal letter. No hype, no
// exclamation marks, no promised outcomes. Estimates are always "illustrative, not advice".

import type { EmailContent, EmailCtx, Template } from "../integrations/email-types";
import type { Dossier } from "./dossier";

// ── Copy blocks keyed by answer value ─────────────────────────────────────────

export const BLOCKERS: Record<string, { name: string; subject: string; body: string[] }> = {
  dev_capacity: {
    name: "no one to build it",
    subject: "No one to build it: what that means here",
    body: [
      "You said there is no one on the team to build this. It is the most common reason founders keep renting.",
      "The program does not need a developer. Claude Code writes the code. What it needs is one curious person who sits in the weekly sessions and keeps going between them.",
      "On the call we can work out who that person might be. Often it is someone in operations or marketing who already does half of it by hand.",
    ],
  },
  agency_lockin: {
    name: "being locked into an agency or retainer",
    subject: "Getting out of a retainer without a gap",
    body: [
      "You said you are locked into an agency or a retainer. That is a real constraint, and I would not ask you to break a contract to start.",
      "We build alongside what you have. Your agency keeps running until the replacement is live on your domain, so nothing goes dark in between.",
      "Bring your notice period to the call and we will plan the build around it. Whether you keep the agency afterwards is your decision.",
    ],
  },
  tracking: {
    name: "tracking you can't trust",
    subject: "Why your ad tracking is hard to trust",
    body: [
      "You said your tracking is hard to trust. You are not imagining it. A browser Pixel on its own misses events, because browsers and consent settings block some of them.",
      "Server-side tracking sends the same events from your own server through the Conversions API, deduplicated against the Pixel. Meta then sees a fuller picture.",
      "The bigger change is what you send. We pass a value for qualified applications, so Meta learns from the people who apply and fit, not the people who click.",
    ],
  },
  tool_sprawl: {
    name: "too many tools that don't connect",
    subject: "One place instead of nine logins",
    body: [
      "You said you have too many tools and nothing is connected. Most growing businesses end up there. Each tool made sense when you bought it.",
      "Part of the work is to put the pieces that matter in one place you own: pages, applications, calls, closes and cash, in one dashboard.",
      "Some tools are worth keeping. We will look at your list together and decide which ones earn their place.",
    ],
  },
  time: {
    name: "no time to lead it",
    subject: "You do not have to lead the build yourself",
    body: [
      "You said you do not have time to lead this. That is honest, and it matters, because this is done with you, not for you.",
      "It takes three to four hours a week for eight weeks, from one person. That person does not have to be you. You join for the decisions.",
      "On the call we can look at who could own it, and what you would need to take off their plate to make room.",
    ],
  },
  ai_doubt: {
    name: "doubt that AI can do this",
    subject: "A fair doubt about AI building real systems",
    body: [
      "You said you are not sure AI can do this. I think that doubt is healthy. A lot of what is sold as AI is a demo, not a system.",
      "Claude Code is a tool. Your team decides what to build, reads what it writes and ships it. We sit with them while they do.",
      "You do not need to take that on faith. In week one you get a written build plan, and the seven-day money-back window covers you if it is not what you expected.",
    ],
  },
};

const BLOCKER_FALLBACK = {
  name: "whatever has held you back",
  body: [
    "Most founders who apply have tried to fix their growth setup before. Usually something got in the way: no one to build it, a retainer, tracking nobody trusts, or simply time.",
    "Asymmetrical is built around those. Claude Code does the heavy lifting, your team owns the result, and we sit with them weekly until they can run it.",
    "If something specific has held you back, reply and tell me. I would rather hear it now than guess.",
  ],
};

export const GOALS: Record<string, string[]> = {
  own_growth: [
    "You said what matters most is a growth machine you own: pages, ads and tracking.",
    "That is the core of the eight weeks. A VSL page and application on your domain, Meta ads with server-side tracking, and a dashboard that shows every application, call and close.",
    "Owning it means your team can change a headline on a Tuesday afternoon without a ticket or an invoice.",
  ],
  cut_costs: [
    "You said what matters most is cutting agency and software costs.",
    "The first step is simple: list what you rent and what each piece costs a year. Then we decide which pieces make sense to own and which to keep.",
    "I will not promise you a saving figure before we have seen the list. What I can promise is that we look at it line by line with you.",
  ],
  internal_tools: [
    "You said what matters most is internal tools and dashboards.",
    "That is often where Claude Code surprises people. The quoting tool, the weekly report, the integration you were going to pay a dev shop for: your team can build these.",
    "We usually start with the one your team asks for most, because that is the one they will actually use.",
  ],
  unsure: [
    "You said you are not sure yet what matters most. That is a fine place to start.",
    "The week-one audit exists for this. We map what you spend, how leads move through your business and where the data lives, then write down what to build first.",
    "On the call we can get a rough sense of it together, before anything is decided.",
  ],
};

const GOAL_FALLBACK = [
  "You did not pick one thing that matters most, so here is how most founders think about it.",
  "Some want a growth machine they own: pages, ads and tracking. Some want to stop paying for agencies and tools. Some want the internal tools nobody has had time to build.",
  "Any of those is a reasonable place to start. We will pick one with you.",
];

export const TIMELINES: Record<string, string> = {
  "0_3": "You said you want this running in the next three months. The program is eight weeks from kickoff, so a start in the next few weeks lines up with that.",
  "3_6": "You said three to six months. That leaves room to finish what is on your plate now and start when there is space for it. We can pick a kickoff date on the call.",
  "6_plus": "You said six months or more. That is fine. The call is still useful for knowing what you would build and what it would ask of your team, so you can plan for it.",
  exploring: "You said you are just exploring. No problem. The call is a good way to find out whether this is worth planning for at all, and I will tell you honestly if it is not.",
};

const TIMELINE_FALLBACK =
  "You did not give a timeline. For reference, the program runs eight weeks from kickoff, and we set the start date together.";

export const OBJECTION_COPY: Record<string, { subject: string; body: string[] }> = {
  Price: {
    subject: "On the price, and how to weigh it",
    body: [
      "On the call, price was the sticking point. That is a fair thing to weigh carefully.",
      "The way I would look at it: put next to it what you pay each year for agencies, freelancers and software, and how much of that you will still be paying in two years.",
      "It is a one-off build that your team keeps. That does not make it the right call for everyone, but it is the comparison that matters.",
      "If the number is the only thing in the way, reply and say so. We can look at a smaller first scope.",
    ],
  },
  Timing: {
    subject: "If the timing is wrong, here is how to plan it",
    body: [
      "On the call, timing came up. Sometimes the honest answer is not now, and that is fine.",
      "If it helps, we can pick a kickoff date further out, so your team can plan around it instead of squeezing it in.",
      "If something specific is in the way, a launch or a busy season, tell me what it is and when it ends.",
    ],
  },
  "Needs to think": {
    subject: "Three questions to help you think it over",
    body: [
      "You said you wanted to think it over. Good. Here are the three questions I would ask myself in your seat.",
      "Who on my team would own this for eight weeks? What do I rent today that I would rather own? And what does it cost me if this looks the same in a year?",
      "If any answer is unclear, reply and we can work through it together.",
    ],
  },
  "Partner/spouse": {
    subject: "Making the decision with your partner",
    body: [
      "You said you wanted to talk it through with your partner first. That is sensible for a decision like this.",
      "If it helps, I am happy to do a short call with both of you, so they can ask their own questions directly.",
      "Or forward them this email and the page, and let them reply to me with anything they want to know.",
    ],
  },
  "Funding doubts": {
    subject: "If the money is the worry, let's look at it",
    body: [
      "On the call you were unsure about funding it right now. I would rather you said that than stretched.",
      "There are ways to shape it, starting with a smaller first scope. That does not change what you own at the end.",
      "If now is genuinely not the time, that is fine too. The door stays open.",
    ],
  },
  "Trust/proof": {
    subject: "You asked for proof. Here is what I can offer",
    body: [
      "On the call you wanted more proof before deciding. That is reasonable. I would rather you check than trust me.",
      "What I can offer is structure, not stories. You get a written build plan in week one, everything runs on your own accounts, and you have seven days from your start date to ask for your money back.",
      "If you want to see the work, ask me to walk you through a live page and dashboard built this way.",
    ],
  },
  "Time to commit": {
    subject: "The time it takes, honestly",
    body: [
      "On the call, the time it takes was the concern. That is the right thing to be careful about.",
      "It is three to four hours a week for eight weeks, from one person. It does not have to be you.",
      "If no one on your team can give that right now, it is better to wait than to start and stall.",
    ],
  },
  "Not a fit": {
    subject: "If it is not a fit, that is useful to know",
    body: [
      "On the call it looked like this might not be the right fit. I would rather we both say that than force it.",
      "If anything changes, a new team member, a new offer, an agency contract ending, I am happy to look again.",
      "In the meantime the resources page has a few things you can use on your own.",
    ],
  },
};

const OBJECTION_FALLBACK = [
  "I have been thinking about our conversation and what might be holding you back.",
  "Most founders weigh the same few things: the price against what they rent today, the time it asks of their team, and whether it will actually work for them.",
  "If one of those is on your mind, reply and tell me which. I will give you a straight answer.",
];

/** Six paragraph sets per lost reason; lo_1 … lo_6 use index 0 … 5. "Other" is the general angle. */
export const LOST_ANGLES: Record<string, string[][]> = {
  Price: [
    ["I understand the price did not work this time. Thank you for being direct about it."],
    ["One thing worth doing anyway: add up what you paid this year for agencies, freelancers and software. It is a useful number to know, whatever you decide."],
    ["If the full scope was the issue, a smaller first build is possible. Pages and tracking first, the rest later."],
    ["Prices for rented tools rarely go down. If your spend has crept up since we spoke, it may be worth another look."],
    ["If budgets have changed since we last spoke, I am happy to look at scope with you again."],
    ["The offer to look at a smaller first scope stands, whenever it suits you."],
  ],
  Timing: [
    ["I understand the timing was not right. That is a good reason to wait."],
    ["When the timing does feel right, the best preparation is a list of what you rent today and who on your team would own the build."],
    ["If the busy period you mentioned is behind you, now might be a better moment to plan a start date."],
    ["A quarter has passed. If there is more room on your team's calendar now, we can pick a kickoff date that suits you."],
    ["Many plans made for later never get a date. If you want to set one, I am happy to help."],
    ["If the timing is better now, the door is open. If not, no problem."],
  ],
  "Chose agency": [
    ["You chose to go with an agency. I hope it goes well, and I mean that."],
    ["One suggestion, whatever you build with them: make sure the pages, tracking and data sit on your own accounts. It keeps your options open."],
    ["A few months in is a good time to check what the agency has built and what you would keep if you stopped tomorrow."],
    ["If the agency relationship is working, keep it. If you are starting to wonder what you own at the end of it, that is when Asymmetrical fits."],
    ["Agency contracts often come up for renewal around now. If yours does, it may be worth comparing the two options again."],
    ["If you ever want your team to own what the agency runs today, the door is open."],
  ],
  "Built in-house": [
    ["You decided to build it in-house. That is the same idea Asymmetrical is built on, so I am glad you are owning it."],
    ["One thing that helps: server-side tracking with a value for qualified leads, so Meta learns from the right people. It is worth doing early."],
    ["If your team gets stuck on a piece, pages, tracking or the dashboard, reply and ask. A short answer costs me nothing."],
    ["A few months in is a good time to check what has shipped and what is still on the list."],
    ["If the build has slowed down, a few weekly sessions with us can get it moving again. Happy to talk about it."],
    ["Whatever stage it is at, I hope it is yours and working. The door is open if you want a hand."],
  ],
  "No response": [
    ["We did not hear back after our conversation, so I will assume now is not the moment. No hard feelings."],
    ["If my emails got buried, that is fine. One reply with yes, no or later is all I need."],
    ["In case it is useful whatever you decide, the resources page has a worksheet for listing what you rent today."],
    ["If things got busy, I understand. If you want to pick the conversation up again, book a time when it suits you."],
    ["Still here if you want to talk. If you would rather I stopped writing, just reply and say so."],
    ["I will leave it here. If it ever makes sense to talk again, you know where to find me."],
  ],
  "Not a fit": [
    ["We agreed it was not a fit for now. Thank you for the honest conversation."],
    ["Fit can change. A new hire, a new offer or an agency contract ending can all make it look different."],
    ["In the meantime, the resources page has a few things you can use on your own."],
    ["If your business has changed since we spoke, I am happy to take another look."],
    ["No pitch here. Just checking whether anything has changed that would make it worth another conversation."],
    ["If it ever becomes a fit, the door is open."],
  ],
  Trust: [
    ["I understand you were not sure enough to go ahead. Trust is earned, and I did not expect to earn it in one call."],
    ["Whatever you decide, a good test for anyone you hire: does everything run on your accounts, and do you get a written plan before the work starts. Asymmetrical does both."],
    ["If you want to see a live page and dashboard built this way, I can walk you through one."],
    ["The seven-day money-back window and the delivery guarantee are there for exactly this kind of doubt. Happy to go through them again."],
    ["If you want to talk to me again before deciding anything, book a time. No pressure."],
    ["The door stays open. If it ever feels right, I am here."],
  ],
  Other: [
    ["Thank you for considering Asymmetrical. I understand it was not the right moment."],
    ["If it is useful, the resources page has a worksheet for listing what you rent today and what it costs."],
    ["A few months on, I wanted to check whether anything has changed on your side."],
    ["If owning your growth setup is still on your list, I am happy to talk again."],
    ["Still here if you want to pick it up. If you would rather I stopped writing, reply and say so."],
    ["This is my last note for a while. The door is open."],
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const hi = (c: EmailCtx) => `Hi ${c.firstName},`;

/** Build content; drops empty paragraphs. */
function mk(subject: string, paragraphs: Array<string | false | null | undefined>, extra: Partial<EmailContent> = {}): EmailContent {
  return { subject, paragraphs: paragraphs.filter((p): p is string => typeof p === "string" && p.length > 0), ...extra };
}

const quoted = (s: string) => `“${s}”`;
const book = (label = "Pick a time") => (c: EmailCtx) => ({ label, path: c.bookPath });
const onCall = (c: EmailCtx) => (c.callTime ? ` on ${c.callTime}` : "");
const oneWord = (d: Dossier) => d.industry?.one || "business";

function blockerCopy(value: string | undefined): { name: string; body: string[] } {
  return (value && BLOCKERS[value]) || BLOCKER_FALLBACK;
}

function goalCopy(d: Dossier): string[] {
  return (d.goal && GOALS[d.goal.value]) || GOAL_FALLBACK;
}

function timelineCopy(d: Dossier): string {
  return (d.timeline && TIMELINES[d.timeline.value]) || TIMELINE_FALLBACK;
}

function spendLine(d: Dossier): string {
  if (d.spend) return `You said you spend ${d.spend.label} a year on agencies, freelancers and software.`;
  return "You did not give a figure for what you spend on agencies, freelancers and software. That is fine.";
}

function buildLine(d: Dossier): string {
  if (d.firstBuild) return `At ${d.firstBuild.spendLabel} a year, what we would likely build first is ${d.firstBuild.build}. That is illustrative, not advice.`;
  return "Without a spend figure, a typical first build is the VSL page and application plus server-side tracking. That is illustrative, not advice.";
}

function industryLines(d: Dossier): string[] {
  if (d.industry) {
    return [
      `In ${d.industry.many}, the pieces most often rented are ${d.industry.rent}.`,
      `A first internal tool that tends to make sense for a ${d.industry.one} is ${d.industry.tool}. Your team would build it with Claude Code and own it afterwards.`,
    ];
  }
  return [
    "Most businesses at your size rent the same few pieces: an ads agency, a page builder, a tracking tool and someone to stitch the reports together.",
    "A first internal tool is usually the one your team asks for most: a quote tracker, a weekly report, a pipeline view. Your team would build it with Claude Code and own it afterwards.",
  ];
}

function lostAngle(d: Dossier, i: number): string[] {
  const sets = LOST_ANGLES[d.lostReason || "Other"] || LOST_ANGLES.Other;
  return sets[i] || LOST_ANGLES.Other[i] || [];
}

function answerList(d: Dossier): string {
  const rows: string[] = [];
  if (d.business) rows.push(`What you sell: ${quoted(d.business)}`);
  if (d.role) rows.push(`Your role: ${d.role.label}`);
  if (d.revenue) rows.push(`Annual revenue: ${d.revenue.label}`);
  if (d.spend) rows.push(`Spend on agencies, freelancers and software: ${d.spend.label}`);
  if (d.goal) rows.push(`What matters most: ${d.goal.label}`);
  if (d.timeline) rows.push(`When you want it running: ${d.timeline.label}`);
  if (d.blockers.length) rows.push(`What has held you back: ${d.blockers.map((b) => b.label).join("; ")}`);
  if (d.readiness) rows.push(`Ready to invest: ${d.readiness.label}`);
  return rows.join("<br>");
}

// ── Pre-call prep ─────────────────────────────────────────────────────────────

const PREP: Record<string, Template> = {
  pp_brief: (c) => {
    const list = answerList(c.d);
    return mk("I read your application before our call", [
      hi(c),
      `Before we speak${onCall(c)}, I read your application properly. Here is what I took from it, so you can correct me if I have anything wrong.`,
      list || "Most of the application came through blank. That is fine, we will cover it on the call.",
      c.d.whyNow && `And in your words, why now: ${quoted(c.d.whyNow)}`,
      "I will use this to skip the basics and spend the call on your situation.",
    ]);
  },
  pp_blocker1: (c) => {
    const v = c.d.blockers[0]?.value;
    const b = blockerCopy(v);
    const subject = (v && BLOCKERS[v]?.subject) || "What usually holds founders back, and how we handle it";
    return mk(subject, [hi(c), ...b.body, "We can go deeper on this on the call."]);
  },
  pp_booking: (c) => {
    const qa = c.d.bookingQA.slice(0, 3);
    return mk("Your answers from the booking form", [
      hi(c),
      qa.length ? "When you booked, you answered a few questions. I read them." : "When you booked there were a few optional questions. If you skipped them, no problem.",
      ...qa.map((x) => (x.q ? `To ${quoted(x.q)} you wrote: ${quoted(x.a)}` : `You wrote: ${quoted(x.a)}`)),
      qa.length
        ? "I will come to the call with those in mind. If anything has changed since, reply and tell me."
        : "If there is one thing you want to be sure we cover, reply with it and I will put it at the top.",
    ]);
  },
  pp_numbers: (c) =>
    mk("What we would likely build first for you", [
      hi(c),
      spendLine(c.d),
      buildLine(c.d),
      "The real plan comes out of the week-one audit, once we have seen your accounts and how leads move through your business.",
      "If your spend figure was a rough guess, that is fine. A closer number before the call helps.",
    ]),
  pp_goal: (c) => mk("What you said matters most right now", [hi(c), ...goalCopy(c.d), "We will start the call there."]),
  pp_industry: (c) =>
    mk("What your kind of business tends to rent", [
      hi(c),
      ...industryLines(c.d),
      "On the call I would like to hear what you rent today, so we can see which pieces are worth owning.",
    ]),
  pp_why_now: (c) =>
    mk("Your reason for looking at this now", [
      hi(c),
      c.d.whyNow
        ? `When I asked why now, you wrote: ${quoted(c.d.whyNow)}`
        : "You left the why-now question blank. That is fine, it was optional.",
      c.d.whyNow
        ? "That is the most useful line in an application. It tells me what this has to change for you."
        : "Before the call, it is worth thinking about one thing: what changes if this works, and what it costs if nothing changes for another year.",
      "We will come back to it on the call, because it decides what we build first.",
    ]),
  pp_partner: (c) => {
    const why =
      c.d.readiness?.value === "partner"
        ? "You said you would decide on something like this with your partner or board."
        : c.d.role?.value === "co_owner"
          ? "You said you are a co-owner of the business."
          : "If anyone else signs off on a decision like this, it is worth having them in the room.";
    return mk("Bring your partner or board to the call", [
      hi(c),
      why,
      "If so, invite them to the call. It saves you explaining it twice, and they can ask their own questions directly.",
      "Forward them the calendar invite, or reply with their email and I will add them.",
    ]);
  },
  pp_timeline: (c) => mk("Your timeline, and what eight weeks looks like", [hi(c), timelineCopy(c.d), "Week one is an audit and a written build plan. Pages, tracking, the dashboard and follow-up follow, and in week eight your team ships a change on its own.", "We will talk about a realistic start date on the call."]),
  pp_blocker2: (c) => {
    const b = blockerCopy(c.d.blockers[1]?.value);
    return mk("The other thing you said has held you back", [
      hi(c),
      c.d.blockers[1] ? `You named more than one thing that has held you back. Here is the second: ${b.name}.` : "One more thought on what tends to hold founders back.",
      ...b.body.slice(1),
    ]);
  },
  pp_homework: (c) =>
    mk("Three things to prepare before we speak", [
      hi(c),
      `To get the most from our call${onCall(c)}, it helps to have three things ready.`,
      "First, a rough number for what you spend a year on agencies, freelancers and software.",
      "Second, your ad account and analytics logins to hand, in case we look at something together. Do not send them to me.",
      "Third, anyone who signs off on a decision like this. Bring them if you can.",
      "That is all. Nothing to buy and nothing to sign before we talk.",
    ]),
};

/** Prep emails that apply to this dossier, most specific first, always ending with pp_homework. */
export function prepTemplates(d: Dossier): string[] {
  const out: string[] = [];
  if (d.hasApplication) out.push("pp_brief");
  if (d.blockers[0]) out.push("pp_blocker1");
  if (d.bookingQA.length) out.push("pp_booking");
  if (d.firstBuild) out.push("pp_numbers");
  if (d.goal) out.push("pp_goal");
  if (d.industry) out.push("pp_industry");
  if (d.whyNow) out.push("pp_why_now");
  if (d.readiness?.value === "partner" || d.role?.value === "co_owner") out.push("pp_partner");
  if (d.timeline) out.push("pp_timeline");
  if (d.blockers[1]) out.push("pp_blocker2");
  out.push("pp_homework");
  return out;
}

// ── No-show ───────────────────────────────────────────────────────────────────

const NO_SHOW: Record<string, Template> = {
  ns_1: (c) =>
    mk("We missed each other on the call", [
      hi(c),
      `It looks like we did not manage to connect for the call${onCall(c)}. No problem, these things happen.`,
      "If you still want to talk, pick a new time that suits you.",
    ], { cta: book("Pick a new time")(c) }),
  ns_goal: (c) =>
    mk("Is what you said matters most still the priority", [
      hi(c),
      goalCopy(c.d)[0],
      goalCopy(c.d)[1],
      "If that is still the priority, the call is the quickest way to see what it would take.",
    ], { cta: book("Book a new time")(c) }),
  ns_blocker: (c) => {
    const b = blockerCopy(c.d.blockers[0]?.value);
    return mk("About what has held you back so far", [
      hi(c),
      c.d.blockers[0] ? `On your application you said what has held you back is ${b.name}.` : "I wanted to say something about what usually holds founders back.",
      b.body[1],
      "If that is still in the way, a short call is a good place to work out whether it can be solved.",
    ], { cta: book("Book a new time")(c) });
  },
  ns_numbers: (c) =>
    mk("What you rent today, and what we would build first", [
      hi(c),
      spendLine(c.d),
      buildLine(c.d),
      "That is what I wanted to go through on the call. If you want to, pick a new time.",
    ], { cta: book("Pick a new time")(c) }),
  ns_5: (c) =>
    mk("How the call runs, in case that helps", [
      hi(c),
      "In case it helps you decide whether to rebook, here is how the call runs.",
      "We look at what you rent today, what you would want to own, and who on your team would run it. Price comes last, and only if it fits.",
      "If it is not a fit, I will say so. Nothing is sold on the call unless it makes sense for you.",
    ], { cta: book("Book a call")(c) }),
  ns_6: (c) =>
    mk("Answers to the questions people ask before rebooking", [
      hi(c),
      "A few questions tend to come up before people rebook, so here are short answers.",
      "Time: three to four hours a week for eight weeks, from one person on your team. Tech: no developer needed, Claude Code does the heavy lifting.",
      "Cost: it depends on scope, so we cover it on the call once we know what you need. Ownership: everything runs on your accounts.",
    ], { cta: book("Pick a time")(c) }),
  ns_final: (c) =>
    mk("Last note about the call you missed", [
      hi(c),
      "This is my last note about the call we missed. I do not want to fill your inbox.",
      "If now is not the time, that is completely fine. The door stays open, and you can book whenever it suits you.",
    ], { cta: book("Book when it suits you")(c) }),
};

// ── Post-call ─────────────────────────────────────────────────────────────────

const POST_CALL: Record<string, Template> = {
  fu_recap: (c) =>
    mk("Thanks for the call today", [
      hi(c),
      "Thank you for the time today. I enjoyed the conversation.",
      "We covered what you rent today, what you would want to own, and how the eight weeks would work with your team.",
      "The next step is your decision. If you have questions first, reply to this email and I will answer them directly.",
      "When you are ready to go ahead, reply to this email and I will send over the agreement and the kickoff dates.",
    ]),
  fu_objection: (c) => {
    const o = c.d.objection ? OBJECTION_COPY[c.d.objection] : undefined;
    return mk(o?.subject || "What might still be on your mind after our call", [hi(c), ...(o?.body || OBJECTION_FALLBACK)]);
  },
  fu_numbers: (c) =>
    mk("The numbers behind what we discussed", [
      hi(c),
      spendLine(c.d),
      buildLine(c.d),
      "The useful comparison is not the price on its own. It is the price against what you will keep paying each year if nothing changes.",
      "The week-one audit turns this into a written plan with your real numbers.",
    ]),
  fu_industry: (c) =>
    mk("How the build would look in a business like yours", [
      hi(c),
      ...industryLines(c.d),
      `The pages, tracking and dashboard would be set up for how your ${oneWord(c.d)} actually takes leads and closes them.`,
    ]),
  fu_goal: (c) => mk("Back to the goal on your application", [hi(c), ...goalCopy(c.d), "If that is still the priority, it is where we would start."]),
  fu_proof: (c) =>
    mk("How to judge this without taking my word for it", [
      hi(c),
      "I would rather you judge this on structure than on stories. Here is how.",
      "Week one ends with a written build plan. You see exactly what we will build and in what order before the real work starts.",
      "Everything runs on your accounts: your domain, your Cloudflare, your ad account. If you stop, you keep all of it.",
      "And you have seven days from your start date to ask for your money back if it is not what you expected.",
    ]),
  fu_time: (c) =>
    mk("What the eight weeks ask of your calendar", [
      hi(c),
      "A practical note on time, since it is the thing founders underestimate in both directions.",
      "It is three to four hours a week for eight weeks, from one person who will own the machine. That includes the weekly session.",
      "You join for decisions, not for every session. After week eight it takes less, because your team runs it.",
    ]),
  fu_risk: (c) =>
    mk("The guarantee, in plain terms", [
      hi(c),
      "Here are the guarantee terms, plainly, so there is no fine print.",
      "One: you have seven days from your start date. If it is not for you, tell us and you get your money back.",
      "Two: if your VSL page, tracking and dashboard are not live by the end of week eight, we keep working with you at no extra cost until they are, as long as you attend the weekly sessions.",
      "What we do not do is promise a revenue number. Nobody honest can.",
    ]),
  fu_final: (c) =>
    mk("Closing the loop on our conversation", [
      hi(c),
      "I do not want to keep nudging you, so this is my last follow-up on our call.",
      "If the answer is not now, that is a perfectly good answer. A one-word reply helps me know where things stand.",
      "If you want to go ahead, reply and I will send over the agreement.",
    ]),
};

// ── Cancelled ─────────────────────────────────────────────────────────────────

const CANCELLED: Record<string, Template> = {
  cx_1: (c) =>
    mk("Saw you cancelled the call", [
      hi(c),
      "I saw the call was cancelled. No problem at all.",
      "If you still want to talk, pick a time that works better.",
    ], { cta: book("Pick a new time")(c) }),
  cx_2: (c) =>
    mk("If the time was the problem, pick another", [
      hi(c),
      "If it was just the time that did not work, there are other slots, including early and late in the day.",
      "If something else changed, that is fine too. Reply and let me know.",
    ], { cta: book("See other times")(c) }),
  cx_3: (c) =>
    mk("What the call covers, if it helps you decide", [
      hi(c),
      "In case it helps you decide whether to rebook: the call covers what you rent today, what you would want to own, and who on your team would run it.",
      "Price comes last, and only if it fits. If it is not a fit, I will say so.",
    ], { cta: book("Book a call")(c) }),
  cx_4: (c) =>
    mk("I will stop asking about the call after this", [
      hi(c),
      "This is my last note about rebooking. I do not want to crowd your inbox.",
      "If you want to talk later, you can book any time. And if there is something you would rather ask by email, reply here.",
    ], { cta: book("Book when it suits you")(c) }),
};

// ── Lost ──────────────────────────────────────────────────────────────────────

const LOST: Record<string, Template> = {
  lo_1: (c) => mk("Thanks for considering Asymmetrical", [hi(c), ...lostAngle(c.d, 0), "No reply needed. I wanted to say thank you."]),
  lo_2: (c) =>
    mk("A few weeks on from our conversation", [
      hi(c),
      "It has been a few weeks since we spoke, and I wanted to share one thought.",
      ...lostAngle(c.d, 1),
    ]),
  lo_3: (c) =>
    mk("Something you can use whether or not we work together", [
      hi(c),
      ...lostAngle(c.d, 2),
      "The resources page has a worksheet for listing what you rent and a short note on server-side tracking. Both are yours to use.",
    ], { cta: { label: "Open the resources", path: "/resources" } }),
  lo_4: (c) =>
    mk("A quarter later: has anything changed on your side", [
      hi(c),
      "It has been about a quarter since we last spoke.",
      ...lostAngle(c.d, 3),
    ], { cta: book("Book a time")(c) }),
  lo_5: (c) =>
    mk("Checking in four months on", [
      hi(c),
      ...lostAngle(c.d, 4),
      "A reply with one line on where things stand is always welcome.",
    ]),
  lo_6: (c) =>
    mk("Six months since we spoke", [
      hi(c),
      "It has been about six months since our conversation, so this is the last note in this series.",
      ...lostAngle(c.d, 5),
    ], { cta: book("Book a time")(c) }),
};

// ── Won onboarding ────────────────────────────────────────────────────────────

const WON: Record<string, Template> = {
  won_1: (c) =>
    mk("Welcome to Asymmetrical, and what happens this week", [
      hi(c),
      "Welcome to Asymmetrical. I am glad we are doing this together.",
      "This week we set the kickoff session, agree who on your team owns the build, and start the audit.",
      "Over the next few days I will send a few short emails: what accounts to have ready, who should own it, and what the week-one audit involves.",
      "If you have a question before then, reply here. It comes straight to me.",
    ]),
  won_2: (c) =>
    mk("Accounts to have ready before kickoff", [
      hi(c),
      "Everything we build runs on your own accounts, so it helps to know where these are before kickoff.",
      "Your domain and where it is registered. A Cloudflare account. Your Meta Business account and ad account. And whatever you use for analytics today.",
      "If you do not have one of these yet, that is fine. We will set it up together.",
      "Please do not send passwords or login codes by email. We will set up access together on the kickoff, with you in control of each step.",
    ]),
  won_3: (c) =>
    mk("Who on your team will own the machine", [
      hi(c),
      "The most important decision before kickoff is who on your team owns this.",
      "It should be one person with three to four hours a week, who is curious and willing to keep going between sessions. They do not need to be technical.",
      "It can be you. Often it is someone in operations or marketing. Reply with their name and I will make sure they are invited to everything.",
    ]),
  won_4: (c) =>
    mk("Your week one audit, and what you get from it", [
      hi(c),
      "Week one is the audit. We map what you spend, how leads move through your business and where your data lives.",
      `It ends with a written build plan: what we build first, in what order, and who does what.${c.d.firstBuild ? ` On your application, the likely first build was ${c.d.firstBuild.build}. That was illustrative, not advice, and the audit decides.` : ""}`,
      "Bring the list of what you rent today if you have it. It makes the audit sharper.",
    ]),
  won_5: (c) =>
    mk("Your seven-day guarantee window, explained", [
      hi(c),
      "A plain note on the guarantee, since you are inside the first two weeks.",
      "You have seven days from your start date. If it is not for you, tell us within that window and you get your money back.",
      "Separately, if your VSL page, tracking and dashboard are not live by the end of week eight, we keep working with you at no extra cost until they are, as long as you attend the weekly sessions.",
      "I would rather you use the window than stay in something that is not right.",
    ]),
  won_6: (c) =>
    mk("Thirty days in: how is it going", [
      hi(c),
      "We are about a month in, and I wanted to check how it feels from your side.",
      "What has shipped, what is stuck, and is the person who owns it getting enough time for it?",
      "Reply with anything, good or bad. It helps me shape the next four weeks.",
    ]),
};

// ── Nurture ───────────────────────────────────────────────────────────────────

const NURTURE: Record<string, Template> = {
  nu_industry: (c) =>
    mk("What businesses like yours rent, and could own", [
      hi(c),
      c.d.industry
        ? `A short note about ${c.d.industry.many}, since that is where your business sits.`
        : "A short note about what most businesses at your size rent, and what they could own instead.",
      ...industryLines(c.d),
      "If owning those pieces is still on your list, a call is the quickest way to see what it would take.",
    ], { cta: book("Book a call")(c) }),
  nu_blocker: (c) => {
    const b = blockerCopy(c.d.blockers[0]?.value);
    return mk("Revisiting what held you back", [
      hi(c),
      c.d.blockers[0] ? `When you applied, you said what had held you back was ${b.name}.` : "When founders apply, most name something that has held them back.",
      b.body[1],
      b.body[2],
    ], { cta: book("Book a call")(c) });
  },
  nu_numbers: (c) =>
    mk("Your spend band, and an illustrative first build", [
      hi(c),
      spendLine(c.d),
      buildLine(c.d),
      "If that number has grown since you applied, it may be worth a conversation.",
    ], { cta: book("Book a call")(c) }),
  nu_agency: (c) =>
    mk("Agency or own it: the honest trade-off", [
      hi(c),
      "An honest view on agencies, since most founders who apply are paying one.",
      "A good agency saves you time. You pay every month, and when you stop, the work usually stops with it.",
      "Owning it costs your team some hours up front. In return the pages, tracking and dashboards are yours, and your people know how to change them.",
      "Neither is right for everyone. It depends on whether you have one person who can own it.",
    ]),
  nu_goal: (c) =>
    mk("The goal on your application, a couple of months on", [
      hi(c),
      ...goalCopy(c.d).slice(0, 2),
      "Is that still the priority? If it is, I am happy to talk about how to get there.",
    ], { cta: book("Book a call")(c) }),
  nu_why: (c) =>
    mk("Is your reason for looking still the same", [
      hi(c),
      c.d.whyNow
        ? `When you applied, I asked why now. You wrote: ${quoted(c.d.whyNow)}`
        : "When you applied, the why-now question was left blank. That is fine, it was optional.",
      c.d.whyNow ? "A few months have passed. Is that still true, or has something changed?" : "A few months on, it is a good question to ask yourself: what would change if your growth setup were yours?",
      "If the reason is still there, the call is a good next step.",
    ], { cta: book("Book a call")(c) }),
  nu_tracking: (c) =>
    mk("Why Meta may be learning from the wrong people", [
      hi(c),
      "One idea worth knowing whatever you decide about Asymmetrical.",
      "Meta optimises for whatever event you send it. If that is a form fill or a page view, it finds more people who fill forms and view pages.",
      "With server-side tracking you can send a value for qualified applications instead. Then Meta learns from the people who fit, not the people who click.",
      "The resources page has a short note on how it works.",
    ], { cta: { label: "Read the note", path: "/resources" } }),
  nu_checkin: (c) =>
    mk("A short check-in, no agenda", [
      hi(c),
      "No pitch today. I wanted to check in and see how things are going.",
      "If anything has changed on your side, a new hire, a contract ending, a new offer, I would be glad to hear about it.",
      "A one-line reply is plenty.",
    ]),
  nu_last: (c) =>
    mk("My last note for a while", [
      hi(c),
      "This is my last scheduled note. Thank you for applying and for reading along.",
      "If you ever want to own your growth setup instead of renting it, you can book a call any time.",
      "Until then, I hope the year goes well.",
    ], { cta: book("Book when it suits you")(c) }),
};

export const FOLLOWUP_TEMPLATES: Record<string, Template> = {
  ...PREP,
  ...NO_SHOW,
  ...POST_CALL,
  ...CANCELLED,
  ...LOST,
  ...WON,
  ...NURTURE,
};

/** Templates that already quote application answers, so the personaliser does not repeat them. */
export const ANSWER_TEMPLATES: Set<string> = new Set([
  "pp_brief", "pp_blocker1", "pp_blocker2", "pp_booking", "pp_numbers", "pp_goal", "pp_industry", "pp_why_now", "pp_timeline", "pp_partner",
  "ns_goal", "ns_blocker", "ns_numbers",
  "fu_numbers", "fu_industry", "fu_goal",
  "won_4",
  "nu_industry", "nu_blocker", "nu_numbers", "nu_goal", "nu_why",
]);

export const FOLLOWUP_TOPICS: Record<string, string[]> = {
  pp_brief: ["application", "call"],
  pp_blocker1: ["blocker"],
  pp_booking: ["booking", "call"],
  pp_numbers: ["numbers", "price"],
  pp_goal: ["goal"],
  pp_industry: ["industry", "tools"],
  pp_why_now: ["why_now"],
  pp_partner: ["call"],
  pp_timeline: ["time", "offer"],
  pp_blocker2: ["blocker"],
  pp_homework: ["call", "resources"],
  ns_1: ["booking", "call"],
  ns_goal: ["goal", "booking"],
  ns_blocker: ["blocker", "booking"],
  ns_numbers: ["numbers", "booking"],
  ns_5: ["call", "booking"],
  ns_6: ["time", "tech", "price"],
  ns_final: ["booking"],
  fu_recap: ["call", "offer"],
  fu_objection: ["price", "time", "trust"],
  fu_numbers: ["numbers", "price"],
  fu_industry: ["industry", "tools"],
  fu_goal: ["goal"],
  fu_proof: ["trust", "guarantee", "ownership"],
  fu_time: ["time"],
  fu_risk: ["guarantee"],
  fu_final: ["call"],
  cx_1: ["booking"],
  cx_2: ["booking"],
  cx_3: ["call", "booking"],
  cx_4: ["booking"],
  lo_1: ["offer"],
  lo_2: ["offer", "ownership"],
  lo_3: ["resources"],
  lo_4: ["offer", "booking"],
  lo_5: ["offer"],
  lo_6: ["offer", "booking"],
  won_1: ["after", "offer"],
  won_2: ["ownership", "tech"],
  won_3: ["time", "after"],
  won_4: ["after", "numbers"],
  won_5: ["guarantee"],
  won_6: ["after"],
  nu_industry: ["industry", "tools"],
  nu_blocker: ["blocker"],
  nu_numbers: ["numbers", "price"],
  nu_agency: ["agency", "ownership"],
  nu_goal: ["goal"],
  nu_why: ["why_now"],
  nu_tracking: ["tracking", "resources"],
  nu_checkin: ["offer"],
  nu_last: ["booking"],
};

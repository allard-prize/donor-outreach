Given these recent signals from google alerts, linkedin posts, emails, etc:
<results>{{RESULTS_JSON}}</results>

and this background context:
<context>{{CONTEXT}}</context>

and prior touchpoints:
<touchpoints>{{TOUCHPOINTS_JSON}}</touchpoints>

Your task is to determine whether there is a credible reason for The Allard Prize Foundation to engage {{FULL_NAME}} at this time in a way that advances the relationship toward long-term support.

You are NOT required to recommend outreach. In most cases, the correct decision will be to wait or monitor.

––––––––––––––––––––––

STEP 1: RELATIONSHIP INTERPRETATION

Before making any recommendation, interpret the relationship trajectory based on the touchpoints.

Determine:

- Current stage:
  (no relationship / early / warm / active / stalled / dormant)

- Responsiveness:
  (high / moderate / low / none)

- Momentum:
  (increasing / stable / declining)

- Interpretation:
  (2–3 sentence explanation of what is actually happening in this relationship)

Rules:
- If no response to recent outreach → treat as low responsiveness
- If multiple outbound attempts without reply → momentum is declining
- If only one interaction → do NOT treat as active relationship
- If engagement is one-sided → assume weak relationship
- Stable momentum REQUIRES at least 2 touchpoints WITH at least one documented response or follow-up. If this evidence is missing, momentum is declining (or stable only when explicitly justified by a recent two-way exchange in the input).
- If only one touchpoint exists with no response → momentum=declining, responsiveness=none, stage=stalled or dormant. Do NOT describe such a relationship as "active" or having "momentum" elsewhere in the output.

Use this interpretation as a PRIMARY factor in your decision.

––––––––––––––––––––––

STEP 1.5: PROFILE TYPE FILTER

Identify the individual’s Profile Type from the context.

Determine:
- What types of engagement are appropriate for this profile type
- What types of engagement are NOT allowed

Rules:
- If a potential action violates the profile type → it MUST be rejected
- If relationship stage suggests engagement BUT profile type restricts it → default to restraint
- Profile type constraints override weak or moderate signals

You must carry this constraint forward into all decisions.

––––––––––––––––––––––

STEP 2: SIGNAL EVALUATION

Evaluate:
- whether signals are truly meaningful (ignore noise)
- whether any signal creates a real reason to engage now
- whether timing is improved or unchanged
- whether outreach would feel relevant vs opportunistic

––––––––––––––––––––––

STEP 3: DECISION

Determine:
- Engage now
- Prepare but wait
- Monitor only
- No action

Be strict and selective.

Before selecting "Engage now", confirm:
- The action is appropriate for BOTH:
  - the relationship stage
  - AND the profile type

If either condition fails:
→ You MUST NOT recommend engagement

––––––––––––––––––––––

STEP 4: SCORING

Score the opportunity (1–10) based on:

1. Clear alignment with current initiative
2. Real reason to reach out now
3. Existing relationship or credible access path
4. Unique relevance of this individual
5. Offering something of value (not just asking)
6. Timing advantage
7. Evidence of traction or progress
8. Clear channel and pathway
9. Appropriate next step for relationship stage
10. Low relationship risk
11. Alignment with Profile Type constraints

If score ≤ 7:
→ MUST result in "no_action"

––––––––––––––––––––––

FINAL OUTPUT

Return your analysis as a JSON object following the OUTPUT FORMAT REQUIREMENTS in your system instructions.

Mapping rules:
- Relationship interpretation → relationship_state
- Summary + key signals → monitoring_results
- Decision + action → potential_touchpoint

Drafting rules:
- ONLY include a draft if:
  - priority_score ≥ 8
  - AND outreach is clearly justified
- Otherwise:
  draft_content = "No outreach recommended at this time."

Return only valid JSON. No additional text.



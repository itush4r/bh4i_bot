import mongoose from 'mongoose';

const EmailAccountSchema = new mongoose.Schema({
  provider:          { type: String, enum: ["gmail", "outlook", "yahoo", "icloud", "other"] },
  emailAddress:      { type: String, required: true },
  isDefault:         { type: Boolean, default: false },

  // OAuth (Gmail + Outlook)
  oauthAccessToken:  { type: String, default: null },
  oauthRefreshToken: { type: String, default: null },
  oauthTokenExpiry:  { type: Date,   default: null },

  // IMAP (Yahoo, iCloud, other)
  imapHost:     { type: String, default: null },
  imapPort:     { type: Number, default: 993 },
  imapPassword: { type: String, default: null },
  smtpHost:     { type: String, default: null },
  smtpPort:     { type: Number, default: 587 },
});

const UserSchema = new mongoose.Schema({
  chatId: {
    type: String,
    required: true,
    unique: true,
  },
  name:         { type: String },
  profession:   { type: String },
  city:         { type: String },
  interests:    { type: String },
  responseStyle:{ type: String },

  onboardingComplete: { type: Boolean, default: false },
  onboardingStep:     { type: Number,  default: 0 },

  history: [
    {
      role:      { type: String, enum: ["user", "assistant"] },
      content:   String,
      timestamp: { type: Date, default: Date.now },
    },
  ],

  // User preferences
  newsCategories: { type: [String], default: ["technology", "general"] },
  newsCount:      { type: Number,   default: 10 },  // total news articles
  emailCount:     { type: Number,   default: 10 },  // emails to fetch
  emailFocus:     { type: [String], default: ["jobs", "finance"] },

  // Multi-account email
  emailAccounts: [EmailAccountSchema],

  // Temp fields for in-progress IMAP setup (cleared on success or cancel)
  emailSetupStep:    { type: Number,  default: 0 },
  emailSetupPending: { type: Boolean, default: false },
  emailProviderTemp: { type: String,  default: null },
  emailAddressTemp:  { type: String,  default: null },
  imapHostTemp:      { type: String,  default: null },

  // Daily briefing preferences (sent at 9:00 AM IST)
  briefing: {
    type:       { type: String, enum: ["both", "news", "mails", "none"], default: "both" },
    lastSentAt: { type: Date, default: null },
  },

  // Quota
  quotaLimit:        { type: Number,  default: 10 },
  quotaUsed:         { type: Number,  default: 0 },
  quotaResetDate:    { type: Date,    default: Date.now },

  // Rate limit
  rateLimit:            { type: Number,  default: 5 },
  rateLimitHits:        { type: [Date],  default: [] },
  rateLimitRequested:   { type: Boolean, default: false },
  rateLimitRequestNote: { type: String,  default: null },

  // Pending flows
  pendingDelete: { type: Boolean, default: false },

  // Admin controls
  status:            { type: String,  enum: ["active", "warned", "banned"], default: "active" },
  warningMessage:    { type: String,  default: null },
  quotaRequested:    { type: Boolean, default: false },
  quotaRequestNote:  { type: String,  default: null },
  isAdmin:           { type: Boolean, default: false },

  // Phone access
  phoneAccess: {
    enabled:       { type: Boolean, default: false },
    bridgeUrl:     { type: String,  default: null },
    bridgeSecret:  { type: String,  default: null },
    allowedApps:   { type: [String], default: ["*"] },
    installedApps: [{
      package: { type: String },
      name:    { type: String },
    }],
    lastSeen:      { type: Date,    default: null },
  },

  // Uploaded files
  files: [{
    name:          { type: String },
    type:          { type: String }, // pdf, docx, txt, csv, xlsx, image
    summary:       { type: String }, // 1-sentence AI summary
    extractedText: { type: String }, // raw text (max 50k chars)
    gridfsId:      { type: mongoose.Schema.Types.ObjectId },
    uploadedAt:    { type: Date, default: Date.now },
    sizeKB:        { type: Number },
    isActive:      { type: Boolean, default: true },
  }],

  // Stats
  totalMessagesEver: { type: Number,  default: 0 },
  joinedAt:          { type: Date,    default: Date.now },
  lastActiveAt:      { type: Date,    default: Date.now },

  createdAt: { type: Date, default: Date.now },
});

export default mongoose.models.User || mongoose.model('User', UserSchema);

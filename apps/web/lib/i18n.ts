/**
 * Internationalization (i18n) module for WalletSync
 * Supports: English ('en'), Bengali ('bn'), Hindi ('hi')
 * Default resolves from browser navigator.language (with fallback to Bengali/English).
 */

export type Locale = 'en' | 'bn' | 'hi';

export interface Translations {
  common: {
    appName: string;
    tagline: string;
    loading: string;
    error: string;
    retry: string;
    empty: string;
    save: string;
    cancel: string;
    close: string;
    copy: string;
    copied: string;
    copiedDesc: string;
    reveal: string;
    hide: string;
    refresh: string;
    search: string;
    filter: string;
    all: string;
    readOnlyNotice: string;
    lastSynced: string;
    neverSynced: string;
    justNow: string;
    live: string;
    status: string;
    date: string;
    amount: string;
    discount: string;
    service: string;
    operator: string;
    customer: string;
    txnId: string;
    portal: string;
    allPortals: string;
    actions: string;
    next: string;
    back: string;
    finish: string;
    statusSuccess: string;
    statusPending: string;
    statusFailed: string;
    statusRefunded: string;
    statusUnknown: string;
  };
  nav: {
    dashboard: string;
    transactions: string;
    reports: string;
    devices: string;
    settings: string;
    onboarding: string;
    commandPalette: string;
  };
  dashboard: {
    title: string;
    subtitle: string;
    kpiSalesToday: string;
    kpiCount: string;
    kpiSuccessRate: string;
    kpiDiscount: string;
    kpiWalletBalance: string;
    deviceOfflineWarning: string;
    deviceLoggedOutWarning: string;
    deviceLayoutChangedWarning: string;
    liveFeedTitle: string;
    liveFeedSubtitle: string;
    noRecentTxns: string;
    noRecentTxnsDesc: string;
    connectExtension: string;
  };
  transactions: {
    title: string;
    subtitle: string;
    searchPlaceholder: string;
    filterAllServices: string;
    filterAllStatuses: string;
    exportCsv: string;
    exportSuccess: string;
    noTxnsFound: string;
    noTxnsFoundDesc: string;
    revealNotice: string;
    detailsTitle: string;
    operatorRef: string;
    time: string;
    rawStatus: string;
    netAmount: string;
    loadMore: string;
  };
  reports: {
    title: string;
    subtitle: string;
    salesByDay: string;
    salesByService: string;
    salesByOperator: string;
    salesByHour: string;
    discountEarned: string;
    vsPreviousPeriod: string;
    totalVolume: string;
    avgTxnValue: string;
    rechargeCount: string;
    peakHour: string;
    emptyState: string;
    emptyStateDesc: string;
  };
  devices: {
    title: string;
    subtitle: string;
    readOnlyBadge: string;
    readOnlyExplanation: string;
    pairNewDevice: string;
    activeDevices: string;
    syncHistory: string;
    deviceLabel: string;
    parserVersion: string;
    statusOk: string;
    statusLoggedOut: string;
    statusLayoutChanged: string;
    statusOffline: string;
    revoke: string;
    revoked: string;
    revokeConfirm: string;
    rowsAccepted: string;
    emptyDevices: string;
    emptyDevicesDesc: string;
    modalTitle: string;
    modalDesc: string;
    expiresIn: string;
    extensionInstruction: string;
  };
  settings: {
    title: string;
    subtitle: string;
    teamTitle: string;
    teamDesc: string;
    privacyTitle: string;
    privacyDesc: string;
    maskToggle: string;
    maskToggleDesc: string;
    retentionTitle: string;
    retentionDesc: string;
    retentionMonths: string;
    notificationsTitle: string;
    notificationsDesc: string;
    offlineAlert: string;
    billingTitle: string;
    billingDesc: string;
    currentPlan: string;
    manageSubscription: string;
    languageTitle: string;
    languageDesc: string;
  };
  onboarding: {
    title: string;
    subtitle: string;
    step1Title: string;
    step1Desc: string;
    step2Title: string;
    step2Desc: string;
    step3Title: string;
    step3Desc: string;
    storeName: string;
    storeNamePlaceholder: string;
    downloadExtBtn: string;
    downloadExtDesc: string;
    pairingInstruction: string;
    waitingForSync: string;
    syncSuccessTitle: string;
    syncSuccessDesc: string;
    goToDashboard: string;
  };
}

export const dictionaries: Record<Locale, Translations> = {
  en: {
    common: {
      appName: 'WalletSync',
      tagline: 'Read-only portal transaction monitor',
      loading: 'Loading...',
      error: 'An error occurred',
      retry: 'Try again',
      empty: 'No records found',
      save: 'Save changes',
      cancel: 'Cancel',
      close: 'Close',
      copy: 'Copy',
      copied: 'Copied!',
      copiedDesc: 'Copied to clipboard',
      reveal: 'Reveal',
      hide: 'Hide',
      refresh: 'Refresh',
      search: 'Search transactions, last 4 digits...',
      filter: 'Filter',
      all: 'All',
      readOnlyNotice: 'Read-only: WalletSync never modifies balance or performs recharges.',
      lastSynced: 'Last synced',
      neverSynced: 'Never synced',
      justNow: 'Just now',
      live: 'LIVE',
      status: 'Status',
      date: 'Date & Time',
      amount: 'Amount',
      discount: 'Discount',
      service: 'Service',
      operator: 'Operator',
      customer: 'Customer',
      txnId: 'Txn ID',
      portal: 'Portal / Website',
      allPortals: 'All Portals',
      actions: 'Actions',
      next: 'Next',
      back: 'Back',
      finish: 'Finish',
      statusSuccess: 'Success',
      statusPending: 'Pending',
      statusFailed: 'Failed',
      statusRefunded: 'Refunded',
      statusUnknown: 'Unknown',
    },
    nav: {
      dashboard: 'Dashboard',
      transactions: 'Transactions',
      reports: 'Reports',
      devices: 'Devices',
      settings: 'Settings',
      onboarding: 'Onboarding',
      commandPalette: 'Command Palette',
    },
    dashboard: {
      title: 'Store Overview',
      subtitle: 'Real-time sync from simplewallet.in',
      kpiSalesToday: "Today's Sales",
      kpiCount: 'Transactions',
      kpiSuccessRate: 'Success Rate',
      kpiDiscount: 'Discount Earned',
      kpiWalletBalance: 'Portal Balance',
      deviceOfflineWarning: 'Extension appears offline. Please check your POS Chrome browser.',
      deviceLoggedOutWarning: 'Logged out of simplewallet.in. Please log in to resume syncing.',
      deviceLayoutChangedWarning: 'Portal table layout changed. Sync halted safely to prevent errors.',
      liveFeedTitle: 'Live Transaction Stream',
      liveFeedSubtitle: 'Updates automatically via Server-Sent Events',
      noRecentTxns: 'No transactions synced yet today',
      noRecentTxnsDesc: 'Open your simplewallet.in history page with the WalletSync extension installed.',
      connectExtension: 'Connect Extension',
    },
    transactions: {
      title: 'Transaction History',
      subtitle: 'Search, audit, and verify all customer recharges',
      searchPlaceholder: 'Search by Txn ID or last 4 digits...',
      filterAllServices: 'All Services',
      filterAllStatuses: 'All Statuses',
      exportCsv: 'Export CSV',
      exportSuccess: 'Transactions exported to CSV',
      noTxnsFound: 'No transactions match your search',
      noTxnsFoundDesc: 'Try adjusting filters or searching for another transaction ID.',
      revealNotice: 'Customer number reveals are audited with actor ID and timestamp.',
      detailsTitle: 'Transaction Details',
      operatorRef: 'Operator Ref',
      time: 'Timestamp',
      rawStatus: 'Raw Status',
      netAmount: 'Net Cost',
      loadMore: 'Load more transactions',
    },
    reports: {
      title: 'Analytics & Trends',
      subtitle: 'Sales volume, operator breakdowns, and commission analytics',
      salesByDay: 'Daily Sales Volume',
      salesByService: 'Volume by Service',
      salesByOperator: 'Volume by Operator',
      salesByHour: 'Hourly Transaction Distribution',
      discountEarned: 'Total Discount / Commission',
      vsPreviousPeriod: 'vs yesterday',
      totalVolume: 'Total Sales Volume',
      avgTxnValue: 'Avg Recharge Value',
      rechargeCount: 'Total Recharges',
      peakHour: 'Peak Recharge Time',
      emptyState: 'No analytics data available yet',
      emptyStateDesc: 'Transaction reports will populate once data is ingested from simplewallet.in.',
    },
    devices: {
      title: 'Connected Devices',
      subtitle: 'Manage paired POS terminals and review sync telemetry',
      readOnlyBadge: 'read-only except one search-button click, see ADR',
      readOnlyExplanation: 'WalletSync extensions are read-only except one search-button click, see ADR. They never touch credentials or execute balance transfers.',
      pairNewDevice: 'Pair New Device',
      activeDevices: 'Active Extension Terminals',
      syncHistory: 'Recent Sync Events',
      deviceLabel: 'Device Label',
      parserVersion: 'Parser Version',
      statusOk: 'Healthy (Syncing)',
      statusLoggedOut: 'Logged Out',
      statusLayoutChanged: 'Layout Drift',
      statusOffline: 'Offline',
      revoke: 'Revoke Access',
      revoked: 'Device Revoked',
      revokeConfirm: 'Are you sure you want to revoke this extension? It will lose access immediately.',
      rowsAccepted: 'Rows Ingested',
      emptyDevices: 'No devices paired yet',
      emptyDevicesDesc: 'Generate a pairing code and enter it in your Chrome extension popup.',
      modalTitle: 'Pair Chrome Extension',
      modalDesc: 'Enter this single-use 8-character pairing code in your WalletSync extension popup within 10 minutes.',
      expiresIn: 'Code expires in 10 minutes',
      extensionInstruction: 'Open the extension popup on your SimpleWallet portal tab, paste this code, and click Connect.',
    },
    settings: {
      title: 'Settings & Privacy',
      subtitle: 'Manage team access, privacy masking, data retention, and preferences',
      teamTitle: 'Team & Roles',
      teamDesc: 'Manage who can view transaction logs and unmask numbers',
      privacyTitle: 'Customer Privacy (PII)',
      privacyDesc: 'India DPDP compliance: mask customer phone numbers by default',
      maskToggle: 'Mask Customer Mobile Numbers',
      maskToggleDesc: 'Displays numbers as ••••••1234. Full numbers require explicit audited reveal.',
      retentionTitle: 'Data Retention',
      retentionDesc: 'Automatically purge historical sync records after retention window',
      retentionMonths: 'Retention Period (Months)',
      notificationsTitle: 'Alerts & Telemetry',
      notificationsDesc: 'Get notified if POS sync encounters an error or pauses',
      offlineAlert: 'Alert if extension offline > 15 minutes',
      billingTitle: 'Subscription & Plan',
      billingDesc: 'WalletSync Retailer Pro (Monthly / Annual via Razorpay)',
      currentPlan: 'Current Plan: Retailer Pro (Active)',
      manageSubscription: 'Manage Billing',
      languageTitle: 'Display Language',
      languageDesc: 'Choose your preferred language (English, বাংলা, हिन्दी)',
    },
    onboarding: {
      title: 'Welcome to WalletSync',
      subtitle: 'Set up your store and pair your first terminal in under 3 minutes',
      step1Title: 'Store Setup',
      step1Desc: 'Name your retailer account',
      step2Title: 'Install Extension',
      step2Desc: 'Add WalletSync to your Chrome browser',
      step3Title: 'Pair & First Sync',
      step3Desc: 'Connect simplewallet.in to your live dashboard',
      storeName: 'Retailer Store Name',
      storeNamePlaceholder: 'e.g. Demo Store & Cyber Cafe',
      downloadExtBtn: 'Download Chrome Extension (.zip)',
      downloadExtDesc: 'Load the unpacked extension in chrome://extensions with Developer Mode on.',
      pairingInstruction: 'Generate your one-time pairing code and enter it in the extension popup.',
      waitingForSync: 'Waiting for first sync from simplewallet.in...',
      syncSuccessTitle: 'First Sync Successful!',
      syncSuccessDesc: 'Your transactions are now streaming securely to your private dashboard.',
      goToDashboard: 'Open Dashboard',
    },
  },

  bn: {
    common: {
      appName: 'WalletSync',
      tagline: 'রিড-অনলি পোর্টাল ট্রানজ্যাকশন মনিটর',
      loading: 'লোড হচ্ছে...',
      error: 'একটি ত্রুটি ঘটেছে',
      retry: 'আবার চেষ্টা করুন',
      empty: 'কোন রেকর্ড পাওয়া যায়নি',
      save: 'পরিবর্তন সংরক্ষণ করুন',
      cancel: 'বাতিল',
      close: 'বন্ধ করুন',
      copy: 'কপি',
      copied: 'কপি হয়েছে!',
      copiedDesc: 'ক্লিপবোর্ডে কপি করা হয়েছে',
      reveal: 'দেখান',
      hide: 'লুকান',
      refresh: 'রিফ্রেশ',
      search: 'ট্রানজ্যাকশন খুঁজুন, শেষ ৪ ডিজিট...',
      filter: 'ফিল্টার',
      all: 'সকল',
      readOnlyNotice: 'শুধুমাত্র পড়ার জন্য: WalletSync কখনও ব্যালেন্স পরিবর্তন বা রিচার্জ করে না।',
      lastSynced: 'সর্বশেষ সিঙ্ক',
      neverSynced: 'কখনও সিঙ্ক হয়নি',
      justNow: 'এইমাত্র',
      live: 'লাইভ',
      status: 'অবস্থা',
      date: 'তারিখ ও সময়',
      amount: 'পরিমাণ',
      discount: 'কমিশন / ছাড়',
      service: 'সার্ভিস',
      operator: 'অপারেটর',
      customer: 'গ্রাহক',
      txnId: 'ট্রানজ্যাকশন আইডি',
      portal: 'পোর্টাল / ওয়েবসাইট',
      allPortals: 'সকল পোর্টাল',
      actions: 'অ্যাকশন',
      next: 'পরবর্তী',
      back: 'পূর্ববর্তী',
      finish: 'সম্পন্ন',
      statusSuccess: 'সফল',
      statusPending: 'অপেক্ষমাণ',
      statusFailed: 'ব্যর্থ',
      statusRefunded: 'রিফান্ড',
      statusUnknown: 'অজ্ঞাত',
    },
    nav: {
      dashboard: 'ড্যাশবোর্ড',
      transactions: 'ট্রানজ্যাকশন',
      reports: 'রিপোর্ট',
      devices: 'ডিভাইসসমূহ',
      settings: 'সেটিংস',
      onboarding: 'অনবোর্ডিং',
      commandPalette: 'কমান্ড প্যালেট',
    },
    dashboard: {
      title: 'দোকানের ওভারভিউ',
      subtitle: 'simplewallet.in থেকে রিয়েল-টাইম লাইভ সিঙ্ক',
      kpiSalesToday: 'আজকের মোট বিক্রি',
      kpiCount: 'মোট রিচার্জ',
      kpiSuccessRate: 'সফলতার হার',
      kpiDiscount: 'অর্জিত কমিশন',
      kpiWalletBalance: 'পোর্টাল ব্যালেন্স',
      deviceOfflineWarning: 'এক্সটেনশন অফলাইনে রয়েছে। আপনার POS ব্রাউজার চেক করুন।',
      deviceLoggedOutWarning: 'simplewallet.in থেকে লগআউট হয়েছে। সিঙ্ক চালু করতে লগইন করুন।',
      deviceLayoutChangedWarning: 'পোর্টাল পেজের লেআউট পরিবর্তন হয়েছে। সুরক্ষার স্বার্থে সিঙ্ক বন্ধ রাখা হয়েছে।',
      liveFeedTitle: 'লাইভ ট্রানজ্যাকশন স্ট্রিম',
      liveFeedSubtitle: 'সার্ভার-সেন্ট ইভেন্টের মাধ্যমে স্বয়ংক্রিয়ভাবে আপডেট হচ্ছে',
      noRecentTxns: 'আজ এখনও কোন ট্রানজ্যাকশন সিঙ্ক হয়নি',
      noRecentTxnsDesc: 'WalletSync এক্সটেনশন ইনস্টল করে আপনার simplewallet হিস্ট্রি পেজটি খুলুন।',
      connectExtension: 'এক্সটেনশন কানেক্ট করুন',
    },
    transactions: {
      title: 'ট্রানজ্যাকশন ইতিহাস',
      subtitle: 'গ্রাহকদের সকল রিচার্জ খুঁজুন, যাচাই ও অডিট করুন',
      searchPlaceholder: 'ট্রানজ্যাকশন আইডি বা শেষ ৪ ডিজিট দিয়ে খুঁজুন...',
      filterAllServices: 'সকল সার্ভিস',
      filterAllStatuses: 'সকল অবস্থা',
      exportCsv: 'CSV এক্সপোর্ট',
      exportSuccess: 'ট্রানজ্যাকশন CSV ফাইলে এক্সপোর্ট হয়েছে',
      noTxnsFound: 'কোন ট্রানজ্যাকশন পাওয়া যায়নি',
      noTxnsFoundDesc: 'ফিল্টার পরিবর্তন করে বা অন্য আইডি দিয়ে চেষ্টা করুন।',
      revealNotice: 'গ্রাহকের নম্বর দেখার সকল অনুরোধ সময় ও অডিটর আইডি সহ সংরক্ষিত হয়।',
      detailsTitle: 'ট্রানজ্যাকশনের বিস্তারিত',
      operatorRef: 'অপারেটর রেফারেন্স',
      time: 'সময়',
      rawStatus: 'মূল স্ট্যাটাস',
      netAmount: 'প্রকৃত খরচ',
      loadMore: 'আরও ট্রানজ্যাকশন দেখুন',
    },
    reports: {
      title: 'অ্যানালিটিক্স ও রিপোর্ট',
      subtitle: 'দৈনিক বিক্রি, অপারেটর বিশ্লেষণ এবং কমিশন হিসাব',
      salesByDay: 'দৈনিক বিক্রির পরিমাণ',
      salesByService: 'সার্ভিস অনুযায়ী বিক্রি',
      salesByOperator: 'অপারেটর অনুযায়ী বিক্রি',
      salesByHour: 'ঘণ্টাভিত্তিক ট্রানজ্যাকশন',
      discountEarned: 'মোট অর্জিত কমিশন',
      vsPreviousPeriod: 'গতকালের তুলনায়',
      totalVolume: 'মোট বিক্রির পরিমাণ',
      avgTxnValue: 'গড় রিচার্জ মূল্য',
      rechargeCount: 'মোট রিচার্জ সংখ্যা',
      peakHour: 'সর্বোচ্চ বিক্রির সময়',
      emptyState: 'কোন অ্যানালিটিক্স তথ্য নেই',
      emptyStateDesc: 'simplewallet.in থেকে ডেটা সিঙ্ক হলে চার্ট ও হিসাব স্বয়ংক্রিয়ভাবে প্রদর্শিত হবে।',
    },
    devices: {
      title: 'সংযুক্ত ডিভাইস',
      subtitle: 'পেইয়ার করা POS টার্মিনাল ও সিঙ্ক টেলিমেট্রি পরিচালনা করুন',
      readOnlyBadge: 'read-only except one search-button click, see ADR',
      readOnlyExplanation: 'WalletSync এক্সটেনশন হলো read-only except one search-button click, see ADR। এটি কখনই পাসওয়ার্ড সংগ্রহ করে না বা টাকা পাঠায় না।',
      pairNewDevice: 'নতুন ডিভাইস যুক্ত করুন',
      activeDevices: 'সক্রিয় টার্মিনাল',
      syncHistory: 'সাম্প্রতিক সিঙ্ক লগ',
      deviceLabel: 'ডিভাইসের নাম',
      parserVersion: 'পার্সার ভার্সন',
      statusOk: 'সঠিক (সিঙ্ক হচ্ছে)',
      statusLoggedOut: 'লগআউট',
      statusLayoutChanged: 'লেআউট পরিবর্তন',
      statusOffline: 'অফলাইন',
      revoke: 'সংযোগ বাতিল করুন',
      revoked: 'ডিভাইস বাতিল করা হয়েছে',
      revokeConfirm: 'আপনি কি নিশ্চিত যে এই এক্সটেনশনের অ্যাক্সেস বাতিল করতে চান?',
      rowsAccepted: 'সিঙ্ক হওয়া রো সংখ্যা',
      emptyDevices: 'কোন ডিভাইস সংযুক্ত নেই',
      emptyDevicesDesc: 'একটি কোড তৈরি করে আপনার ক্রোম এক্সটেনশনে প্রবেশ করান।',
      modalTitle: 'ক্রোম এক্সটেনশন কানেক্ট করুন',
      modalDesc: 'এই ৮ অক্ষরের ওয়ান-টাইম কোডটি ১০ মিনিটের মধ্যে আপনার এক্সটেনশনে প্রবেশ করান।',
      expiresIn: 'কোডের মেয়াদ ১০ মিনিট',
      extensionInstruction: 'SimpleWallet পোর্টালে গিয়ে এক্সটেনশন পপআপ খুলুন এবং কোডটি পেস্ট করুন।',
    },
    settings: {
      title: 'সেটিংস ও গোপনীয়তা',
      subtitle: 'অ্যাকাউন্ট কন্ট্রোল, গ্রাহকের প্রাইভেসি ও ভাষা নির্ধারণ',
      teamTitle: 'টিম ও রোল',
      teamDesc: 'কে লগ দেখতে পারবে ও মোবাইল নম্বর আনমাস্ক করতে পারবে তা নিয়ন্ত্রণ করুন',
      privacyTitle: 'গ্রাহকের গোপনীয়তা (PII)',
      privacyDesc: 'আইন অনুযায়ী গ্রাহকের মোবাইল নম্বর ডিফল্টভাবে গোপন রাখা হয়',
      maskToggle: 'গ্রাহকের নম্বর গোপন রাখুন',
      maskToggleDesc: 'নম্বরগুলো ••••••1234 হিসেবে দেখায়। পূর্ণ নম্বর দেখতে অডিট লগ তৈরি হয়।',
      retentionTitle: 'ডেটা সংরক্ষণ সীমা',
      retentionDesc: 'নির্দিষ্ট সময় পর স্বয়ংক্রিয়ভাবে পুরাতন ট্রানজ্যাকশন ডিলিট করুন',
      retentionMonths: 'সংরক্ষণের সময়কাল (মাস)',
      notificationsTitle: 'সতর্কবার্তা ও নোটিফিকেশন',
      notificationsDesc: 'সিঙ্ক বন্ধ হলে বা সমস্যা দেখা দিলে নোটিফিকেশন পান',
      offlineAlert: '১৫ মিনিট অফলাইন থাকলে সতর্কতা বার্তা পাঠান',
      billingTitle: 'প্ল্যান ও বিলিং',
      billingDesc: 'WalletSync রিটেইলার প্রো (Razorpay দ্বারা পরিচালিত)',
      currentPlan: 'বর্তমান প্ল্যান: রিটেইলার প্রো (সক্রিয়)',
      manageSubscription: 'বিলিং ম্যানেজ করুন',
      languageTitle: 'ভাষা নির্বাচন',
      languageDesc: 'আপনার পছন্দের ভাষা নির্বাচন করুন (English, বাংলা, हिन्दी)',
    },
    onboarding: {
      title: 'WalletSync-এ স্বাগতম',
      subtitle: '৩ মিনিটের মধ্যে আপনার দোকান সেটআপ করুন ও টার্মিনাল কানেক্ট করুন',
      step1Title: 'দোকান সেটআপ',
      step1Desc: 'আপনার দোকানের নাম দিন',
      step2Title: 'এক্সটেনশন ইনস্টল',
      step2Desc: 'ক্রোম ব্রাউজারে এক্সটেনশন যুক্ত করুন',
      step3Title: 'কানেক্ট ও প্রথম সিঙ্ক',
      step3Desc: 'simplewallet.in ড্যাশবোর্ডের সাথে লাইভ যুক্ত করুন',
      storeName: 'দোকানের নাম',
      storeNamePlaceholder: 'যেমন: গাজী টেলিকম',
      downloadExtBtn: 'ক্রোম এক্সটেনশন ডাউনলোড (.zip)',
      downloadExtDesc: 'chrome://extensions-এ ডেভেলপার মোড চালু করে আনপ্যাকড এক্সটেনশন লোড করুন।',
      pairingInstruction: 'কোড জেনারেট করে এক্সটেনশন পপআপে প্রবেশ করান।',
      waitingForSync: 'প্রথম সিঙ্কের জন্য অপেক্ষা করা হচ্ছে...',
      syncSuccessTitle: 'প্রথম সিঙ্ক সফল হয়েছে!',
      syncSuccessDesc: 'আপনার ট্রানজ্যাকশন এখন রিয়েল-টাইমে সুরক্ষিত ড্যাশবোর্ডে দেখা যাবে।',
      goToDashboard: 'ড্যাশবোর্ড খুলুন',
    },
  },

  hi: {
    common: {
      appName: 'WalletSync',
      tagline: 'रीड-ओनली पोर्टल ट्रांजैक्शन मॉनिटर',
      loading: 'लोड हो रहा है...',
      error: 'एक त्रुटि हुई',
      retry: 'पुनः प्रयास करें',
      empty: 'कोई रिकॉर्ड नहीं मिला',
      save: 'बदलाव सहेजें',
      cancel: 'रद्द करें',
      close: 'बंद करें',
      copy: 'कॉपी',
      copied: 'कॉपी हो गया!',
      copiedDesc: 'क्लिपबोर्ड पर कॉपी किया गया',
      reveal: 'दिखाएं',
      hide: 'छिपाएं',
      refresh: 'रिफ्रेश',
      search: 'ट्रांजैक्शन खोजें, अंतिम 4 अंक...',
      filter: 'फ़िल्टर',
      all: 'सभी',
      readOnlyNotice: 'केवल पढ़ने के लिए: WalletSync कभी भी बैलेंस नहीं बदलता और न ही रिचार्ज करता है।',
      lastSynced: 'अंतिम सिंक',
      neverSynced: 'कभी सिंक नहीं हुआ',
      justNow: 'अभी-अभी',
      live: 'लाइव',
      status: 'स्थिति',
      date: 'तारीख व समय',
      amount: 'राशि',
      discount: 'छूट / कमीशन',
      service: 'सेवा',
      operator: 'ऑपरेटर',
      customer: 'ग्राहक',
      txnId: 'ट्रांजैक्शन आईडी',
      portal: 'पोर्टल / वेबसाइट',
      allPortals: 'सभी पोर्टल',
      actions: 'कार्रवाई',
      next: 'आगे',
      back: 'पीछे',
      finish: 'समाप्त',
      statusSuccess: 'सफल',
      statusPending: 'लंबित',
      statusFailed: 'विफल',
      statusRefunded: 'वापस किया गया',
      statusUnknown: 'अज्ञात',
    },
    nav: {
      dashboard: 'डैशबोर्ड',
      transactions: 'लेन-देन',
      reports: 'रिपोर्ट्स',
      devices: 'उपकरण',
      settings: 'सेटिंग्स',
      onboarding: 'ऑनबोर्डिंग',
      commandPalette: 'कमांड पैलेट',
    },
    dashboard: {
      title: 'स्टोर अवलोकन',
      subtitle: 'simplewallet.in से रियल-टाइम सिंक',
      kpiSalesToday: 'आज की कुल बिक्री',
      kpiCount: 'कुल रिचार्ज',
      kpiSuccessRate: 'सफलता दर',
      kpiDiscount: 'अर्जित कमीशन',
      kpiWalletBalance: 'पोर्टल बैलेंस',
      deviceOfflineWarning: 'एक्सटेंशन ऑफलाइन है। कृपया अपना POS ब्राउज़र जांचें।',
      deviceLoggedOutWarning: 'simplewallet.in से लॉगआउट हो गया है। सिंक शुरू करने के लिए लॉगिन करें।',
      deviceLayoutChangedWarning: 'पोर्टल लेआउट बदल गया है। त्रुटि रोकने के लिए सिंक रोक दिया गया है।',
      liveFeedTitle: 'लाइव ट्रांजैक्शन फीड',
      liveFeedSubtitle: 'सर्वर-सेंट इवेंट्स के जरिए स्वतः अपडेट होता है',
      noRecentTxns: 'आज अभी तक कोई ट्रांजैक्शन सिंक नहीं हुआ',
      noRecentTxnsDesc: 'WalletSync एक्सटेंशन के साथ अपना simplewallet हिस्ट्री पेज खोलें।',
      connectExtension: 'एक्सटेंशन कनेक्ट करें',
    },
    transactions: {
      title: 'लेन-देन इतिहास',
      subtitle: 'सभी ग्राहक रिचार्ज खोजें, सत्यापित करें और ऑडिट करें',
      searchPlaceholder: 'आईडी या अंतिम 4 अंकों से खोजें...',
      filterAllServices: 'सभी सेवाएं',
      filterAllStatuses: 'सभी स्थितियां',
      exportCsv: 'CSV निर्यात',
      exportSuccess: 'ट्रांजैक्शन CSV में निर्यात किए गए',
      noTxnsFound: 'कोई लेन-देन नहीं मिला',
      noTxnsFoundDesc: 'फ़िल्टर बदलें या अन्य आईडी से खोजें।',
      revealNotice: 'ग्राहक नंबर देखने का हर अनुरोध समय और आईडी के साथ ऑडिट किया जाता है।',
      detailsTitle: 'लेन-देन का विवरण',
      operatorRef: 'ऑपरेटर संदर्भ',
      time: 'समय',
      rawStatus: 'मूल स्थिति',
      netAmount: 'शुद्ध लागत',
      loadMore: 'और लेन-देन लोड करें',
    },
    reports: {
      title: 'एनालिटिक्स व ट्रेंड्स',
      subtitle: 'दैनिक बिक्री, ऑपरेटर विभाजन और कमीशन विश्लेषण',
      salesByDay: 'दैनिक बिक्री मात्रा',
      salesByService: 'सेवा अनुसार बिक्री',
      salesByOperator: 'ऑपरेटर अनुसार बिक्री',
      salesByHour: 'घंटेवार लेन-देन',
      discountEarned: 'कुल अर्जित कमीशन',
      vsPreviousPeriod: 'कल की तुलना में',
      totalVolume: 'कुल बिक्री राशि',
      avgTxnValue: 'औसत रिचार्ज मूल्य',
      rechargeCount: 'कुल रिचार्ज संख्या',
      peakHour: 'अधिकतम बिक्री समय',
      emptyState: 'कोई एनालिटिक्स डेटा उपलब्ध नहीं है',
      emptyStateDesc: 'simplewallet.in से डेटा आने पर रिपोर्ट स्वतः प्रदर्शित होंगी।',
    },
    devices: {
      title: 'कनेक्टेड उपकरण',
      subtitle: 'पेयर किए गए POS टर्मिनलों को प्रबंधित करें',
      readOnlyBadge: 'read-only except one search-button click, see ADR',
      readOnlyExplanation: 'WalletSync एक्सटेंशन read-only except one search-button click, see ADR है। यह पासवर्ड या पैसे का हस्तांतरण कभी नहीं करता।',
      pairNewDevice: 'नया उपकरण जोड़ें',
      activeDevices: 'सक्रिय टर्मिनल',
      syncHistory: 'हालिया सिंक गतिविधियां',
      deviceLabel: 'उपकरण का नाम',
      parserVersion: 'पार्सर संस्करण',
      statusOk: 'सही (सिंक जारी)',
      statusLoggedOut: 'लॉगआउट',
      statusLayoutChanged: 'लेआउट बदला',
      statusOffline: 'ऑफलाइन',
      revoke: 'एक्सेस हटाएं',
      revoked: 'उपकरण हटा दिया गया',
      revokeConfirm: 'क्या आप निश्चित रूप से इस एक्सटेंशन की अनुमति हटाना चाहते हैं?',
      rowsAccepted: 'सिंक की गई पंक्तियां',
      emptyDevices: 'कोई उपकरण कनेक्ट नहीं है',
      emptyDevicesDesc: 'एक पेयरिंग कोड बनाएं और एक्सटेंशन में दर्ज करें।',
      modalTitle: 'क्रोम एक्सटेंशन कनेक्ट करें',
      modalDesc: 'यह 8-अक्षरों का कोड 10 मिनट के भीतर अपने एक्सटेंशन पॉपअप में दर्ज करें।',
      expiresIn: 'कोड की वैधता 10 मिनट है',
      extensionInstruction: 'SimpleWallet पोर्टल पर एक्सटेंशन खोलें और कोड पेस्ट करें।',
    },
    settings: {
      title: 'सेटिंग्स व गोपनीयता',
      subtitle: 'टीम एक्सेस, गोपनीयता और भाषा सेटिंग्स प्रबंधित करें',
      teamTitle: 'टीम और भूमिकाएं',
      teamDesc: 'तय करें कि कौन ट्रांजैक्शन देख सकता है और नंबर अनमास्क कर सकता है',
      privacyTitle: 'ग्राहक गोपनीयता (PII)',
      privacyDesc: 'ग्राहक मोबाइल नंबर डिफ़ॉल्ट रूप से छिपा कर रखे जाते हैं',
      maskToggle: 'ग्राहक मोबाइल नंबर मास्क करें',
      maskToggleDesc: 'नंबर ••••••1234 के रूप में दिखते हैं। पूरा नंबर देखने पर ऑडिट लॉग दर्ज होता है।',
      retentionTitle: 'डेटा प्रतिधारण',
      retentionDesc: 'निर्धारित समय बाद पुराना डेटा स्वतः हटा दिया जाता है',
      retentionMonths: 'प्रतिधारण अवधि (महीने)',
      notificationsTitle: 'सूचनाएं व अलर्ट',
      notificationsDesc: 'सिंक रुकने या त्रुटि होने पर अलर्ट प्राप्त करें',
      offlineAlert: '15 मिनट ऑफलाइन रहने पर चेतावनी दें',
      billingTitle: 'प्लान व बिलिंग',
      billingDesc: 'WalletSync रिटेलर प्रो (Razorpay द्वारा समर्थित)',
      currentPlan: 'वर्तमान प्लान: रिटेलर प्रो (सक्रिय)',
      manageSubscription: 'बिलिंग प्रबंधन',
      languageTitle: 'भाषा प्राथमिकता',
      languageDesc: 'अपनी पसंदीदा भाषा चुनें (English, বাংলা, हिन्दी)',
    },
    onboarding: {
      title: 'WalletSync में आपका स्वागत है',
      subtitle: '3 मिनट में अपना स्टोर सेटअप करें और टर्मिनल कनेक्ट करें',
      step1Title: 'स्टोर सेटअप',
      step1Desc: 'अपने स्टोर का नाम दर्ज करें',
      step2Title: 'एक्सटेंशन इंस्टॉल करें',
      step2Desc: 'क्रोम ब्राउज़र में WalletSync जोड़ें',
      step3Title: 'कनेक्ट व प्रथम सिंक',
      step3Desc: 'simplewallet.in को डैशबोर्ड से लाइव जोड़ें',
      storeName: 'स्टोर का नाम',
      storeNamePlaceholder: 'उदा. गाजी टेलीकॉम',
      downloadExtBtn: 'क्रोम एक्सटेंशन डाउनलोड (.zip)',
      downloadExtDesc: 'chrome://extensions में Developer Mode चालू करके एक्सटेंशन लोड करें।',
      pairingInstruction: 'कोड जेनरेट करके एक्सटेंशन पॉपअप में दर्ज करें।',
      waitingForSync: 'प्रथम सिंक की प्रतीक्षा की जा रही है...',
      syncSuccessTitle: 'प्रथम सिंक सफल रहा!',
      syncSuccessDesc: 'आपका लेन-देन अब सुरक्षित रूप से लाइव डैशबोर्ड पर उपलब्ध है।',
      goToDashboard: 'डैशबोर्ड खोलें',
    },
  },
};

/**
 * Format currency amount with Indian numbering system (en-IN: ₹1,24,698.98)
 */
export function formatPaise(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/**
 * Format date in Asia/Kolkata timezone
 */
export function formatKolkataDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  } catch {
    return isoString;
  }
}


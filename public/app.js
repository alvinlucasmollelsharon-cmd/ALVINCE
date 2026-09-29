const app = document.querySelector('#app');
const toastRegion = document.querySelector('#toast-region');
let messageSyncTimer = null;
let messageSyncInFlight = false;
let messageSyncEpoch = 0;
let typingStopTimer = null;
let lastTypingPingAt = 0;

const icons = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  video: '<rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3z"/>',
  picture: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/>',
  idea: '<path d="M9 18h6M10 22h4M8.2 14.6A7 7 0 1 1 15.8 14.6c-1 .8-1.6 1.7-1.8 2.4h-4c-.2-.7-.8-1.6-1.8-2.4Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  moon: '<path d="M20.8 14.2A8.5 8.5 0 0 1 9.8 3.2 8.5 8.5 0 1 0 20.8 14.2Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2m10-10h-2M4 12H2m17.1 7.1-1.4-1.4M6.3 6.3 4.9 4.9m14.2 0-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
  arrow: '<path d="M5 12h14m-7-7 7 7-7 7"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  spark: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m19 14 1.1 2.9L23 18l-2.9 1.1L19 22l-1.1-2.9L15 18l2.9-1.1L19 14Z"/>',
  dots: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.9M16 3.2a4 4 0 0 1 0 7.6"/>',
  shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
  close: '<path d="m18 6-12 12M6 6l12 12"/>',
  comment: '<path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5Z"/>',
  messages: '<path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5Z"/><path d="M8 11h8M8 14h5"/>',
  story: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/>',
};
const ico = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.spark}</svg>`;
const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const initials = (name = '?') => esc(name.trim().split(/[\s._-]+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || '?');
const iconFor = (type) => ({ video: 'video', picture: 'picture', idea: 'idea' })[type] || 'idea';
const labelFor = (type) => ({ video: 'Video', picture: 'Picture', idea: 'Idea' })[type] || 'Post';
function storyFileKind(file) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type) || ['mp4', 'webm', 'mov'].includes(extension)) return 'video';
  if (['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(file.type) || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(extension)) return 'picture';
  return null;
}

const state = {
  user: null,
  csrfToken: null,
  page: 'home',
  feedType: 'all',
  posts: [],
  stories: [],
  friends: [],
  incomingRequests: [],
  outgoingRequests: [],
  messageFriends: [],
  activeConversationId: null,
  conversation: null,
  storyIndex: 0,
  storyFile: null,
  storyCaption: '',
  profile: null,
  profilePosts: [],
  profileTab: 'posts',
  selectedPostId: null,
  modal: null,
  authMode: 'login',
  authError: '',
  composeType: 'video',
  selectedFile: null,
  previewUrl: null,
  uploadProgress: null,
  uploading: false,
  profileDraft: null,
  adminTab: 'users',
  adminUsers: [],
  adminPosts: [],
  adminLoaded: false,
  searchQuery: '',
  searchResults: null,
  searchOpen: false,
  theme: localStorage.getItem('alvince-theme') || 'light',
};

function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    options.body = JSON.stringify(options.json);
    delete options.json;
  }
  if (state.csrfToken && options.method && !['GET', 'HEAD'].includes(options.method.toUpperCase())) headers.set('X-CSRF-Token', state.csrfToken);
  return fetch(path, { credentials: 'same-origin', ...options, headers }).then(async (response) => {
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && state.user) {
        state.user = null; state.csrfToken = null; render();
      }
      throw new Error(result.error || 'Something went wrong. Please try again.');
    }
    return result;
  });
}

function avatar(user, size = '') {
  if (!user) return `<span class="avatar ${size}" aria-hidden="true">A</span>`;
  const admin = user.role === 'admin' ? ' avatar-admin' : '';
  return `<span class="avatar ${size}${admin}" aria-hidden="true">${user.avatarUrl ? `<img src="${esc(user.avatarUrl)}" alt="">` : initials(user.username)}</span>`;
}

function ago(dateString) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.max(0, (Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

function formatDate(date) {
  return new Date(date).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function navLinks() {
  return [
    ['home', 'Home', 'home', 'all'],
    ['videos', 'Videos', 'video', 'video'],
    ['pictures', 'Pictures', 'picture', 'picture'],
    ['ideas', 'Ideas', 'idea', 'idea'],
  ];
}

function currentNav(page = state.page, feedType = state.feedType) {
  if (page === 'profile') return 'profile';
  if (page === 'admin') return 'admin';
  if (page !== 'home') return page;
  return ({ all: 'home', video: 'videos', picture: 'pictures', idea: 'ideas' })[feedType] || 'home';
}



function contactsSidebar() {
  const active = currentNav();
  const contacts = state.messageFriends.length ? state.messageFriends : state.friends.map((friend) => ({ ...friend, friendId: friend.friendId || friend.id }));
  const activeId = state.conversation?.friend.id || state.activeConversationId;
  return `<aside class="contacts-sidebar" aria-label="Friends and conversations">
    <header class="contacts-top"><button class="contacts-brand" type="button" data-action="feed-nav" data-type="all" aria-label="ALVINCE home"><span class="brand-mark">A</span><span class="brand-name">ALVINCE</span></button><button class="contacts-profile" type="button" data-action="${state.user ? 'profile-me' : 'auth-login'}" aria-label="${state.user ? 'Open your profile' : 'Log in'}">${avatar(state.user, 'avatar-sm')}</button></header>
    <nav class="contacts-nav" aria-label="Main navigation"><button class="contacts-nav-link ${['home', 'videos', 'pictures', 'ideas'].includes(active) ? 'active' : ''}" type="button" data-action="feed-nav" data-type="all">${ico('home')}<span>Feed</span></button><button class="contacts-nav-link ${active === 'friends' ? 'active' : ''}" type="button" data-action="friends">${ico('users')}<span>Friends</span>${state.incomingRequests.length ? `<span class="nav-badge">${state.incomingRequests.length}</span>` : ''}</button><button class="contacts-nav-link ${active === 'messages' ? 'active' : ''}" type="button" data-action="messages">${ico('messages')}<span>Chats</span>${state.messageFriends.some((friend) => friend.unread) ? '<span class="nav-badge">•</span>' : ''}</button></nav>
    <div class="contacts-heading"><div><p class="contacts-kicker">YOUR PEOPLE</p><h1>Chats</h1></div>${state.user?.role === 'admin' ? `<button class="contacts-tool" type="button" data-action="admin" aria-label="Owner dashboard">${ico('shield')}</button>` : ''}</div>
    <button class="contacts-search" type="button" data-action="focus-search">${ico('search')}<span>Find people or start a chat</span></button>
    <div class="contacts-list" aria-label="Friends">${contacts.length ? contacts.map((friend) => `<button class="contact-row ${activeId === friend.friendId ? 'active' : ''}" type="button" data-action="open-chat" data-id="${esc(friend.friendId)}">${avatar(friend)}<span class="contact-copy"><span class="contact-name">@${esc(friend.username)}</span><span class="contact-preview">${esc(friend.lastMessage || 'You’re friends — say hello')}</span></span><span class="contact-meta">${friend.unread ? `<span class="chat-unread">${friend.unread}</span>` : friend.lastMessageAt ? `<time>${esc(ago(friend.lastMessageAt))}</time>` : ''}</span></button>`).join('') : state.user ? `<div class="contacts-empty"><span class="contacts-empty-icon">${ico('users')}</span><b>Your circle starts here</b><p>Add a friend and their username will appear here.</p><button class="btn btn-small" type="button" data-action="focus-search">Find people ${ico('arrow')}</button></div>` : `<div class="contacts-empty"><span class="contacts-empty-icon">${ico('messages')}</span><b>Your people, in one place</b><p>Join ALVINCE to add friends and start private conversations.</p><button class="btn btn-small" type="button" data-action="auth-register">Join ALVINCE ${ico('arrow')}</button></div>`}</div>
    <footer class="contacts-footer">${state.user ? `<button class="contacts-create" type="button" data-action="compose">${ico('plus')}<span>Share something</span></button><button class="contacts-account" type="button" data-action="profile-me">${avatar(state.user)}<span><b>@${esc(state.user.username)}</b><small>Your profile</small></span></button>` : `<button class="contacts-login" type="button" data-action="auth-login">Log in</button><button class="contacts-signup" type="button" data-action="auth-register">Create account</button>`}</footer>
  </aside>`;
}

function topbar() {
  const text = state.page === 'admin' ? 'Admin' : state.page === 'profile' ? 'Community profile' : state.page === 'friends' ? 'Your circle' : state.page === 'messages' ? 'Private conversations' : state.feedType === 'all' ? 'Your daily dose of inspiration' : `Explore ${labelFor(state.feedType).toLowerCase()}s`;
  const shortcut = /Mac|iPhone|iPad/i.test(navigator.platform || '') ? '⌘ K' : 'Ctrl K';
  return `<header class="topbar"><div class="topbar-left">
      <button class="mobile-brand" type="button" data-action="navigate" data-page="home"><span class="brand-mark">A</span><span>ALVINCE</span></button>
      <div><p class="topbar-kicker">${esc(text)}</p><p class="topbar-title">${state.page === 'admin' ? 'Owner dashboard' : state.page === 'profile' ? 'A closer look' : state.page === 'friends' ? 'People you’ve added' : state.page === 'messages' ? 'Say hello to a friend' : 'Good things happen here'}</p></div>
    </div><div class="topbar-right">
      <label class="search-box" for="global-search">${ico('search')}<input id="global-search" type="search" autocomplete="off" placeholder="Search people & posts" value="${esc(state.searchQuery)}" aria-label="Search people and posts"><span class="search-shortcut">${shortcut}</span></label>
      <button class="icon-button" type="button" data-action="theme" aria-label="Switch ${state.theme === 'light' ? 'to dark' : 'to light'} theme">${ico(state.theme === 'light' ? 'moon' : 'sun')}</button>
      <button class="topbar-avatar" type="button" data-action="${state.user ? 'profile-me' : 'auth-login'}" aria-label="${state.user ? 'Open your profile' : 'Log in'}">${avatar(state.user, 'avatar-sm')}</button>
    </div>
    ${state.searchOpen ? searchPopover() : ''}
  </header>`;
}

function hero() {
  return `<section class="hero-card"><div class="hero-copy"><p class="hero-eyebrow">A SOCIAL SPACE FOR YOU</p><h1 class="hero-title">Make room for things worth sharing.</h1><p class="hero-copy-text">Good videos, bright little moments and ideas that deserve a conversation. Your people are right here.</p><button class="btn" type="button" data-action="${state.user ? 'compose' : 'auth-register'}">${state.user ? 'Share something' : 'Find your people'} ${ico('arrow')}</button></div><div class="hero-spark" aria-hidden="true">a<span></span></div></section>`;
}

function feedComposer() {
  return `<button class="composer-trigger" type="button" data-action="${state.user ? 'compose' : 'auth-register'}">${avatar(state.user)}<span class="composer-placeholder">${state.user ? 'What would you like to share?' : 'Join the conversation…'}</span><span class="plus">${ico('plus')}</span></button>`;
}

function storyStrip() {
  const latestByPerson = new Map();
  for (const story of [...state.stories].reverse()) latestByPerson.set(story.userId, story);
  const ownStory = state.user ? [...latestByPerson.values()].find((story) => story.userId === state.user.id) : null;
  const people = [...latestByPerson.values()].filter((story) => story.userId !== state.user?.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return `<section class="story-strip" aria-label="Stories"><div class="story-strip-head"><div><p class="story-eyebrow">A MOMENT, FOR A MOMENT</p><h2>Stories</h2></div>${state.user ? `<button class="story-upload-shortcut" type="button" data-action="story-create">${ico('plus')} Add story</button>` : '<span class="rail-muted">Fresh moments disappear after 24 hours</span>'}</div><div class="story-people">${state.user ? `<button class="story-person" type="button" data-action="${ownStory ? 'view-story' : 'story-create'}" ${ownStory ? `data-index="${state.stories.findIndex((story) => story.id === ownStory.id)}"` : ''}><span class="story-ring ${ownStory ? '' : 'story-own'}">${avatar(ownStory || state.user, 'avatar-lg')}</span><span class="story-person-name">Your story</span>${!ownStory ? '<span class="story-add">+</span>' : ''}</button>` : ''}${people.map((story) => `<button class="story-person" type="button" data-action="view-story" data-index="${state.stories.findIndex((item) => item.id === story.id)}"><span class="story-ring">${avatar(story, 'avatar-lg')}</span><span class="story-person-name">${esc(story.username)}</span></button>`).join('')}${!state.user && !people.length ? '<span class="story-empty">Log in to share a story with your community.</span>' : ''}</div></section>`;
}

function feedTabs() {
  return `<div class="feed-toolbar"><div class="feed-tabs" role="tablist" aria-label="Content type">${[['all', 'For you'], ['video', 'Videos'], ['picture', 'Pictures'], ['idea', 'Ideas']].map(([type, label]) => `<button class="feed-tab ${state.feedType === type ? 'active' : ''}" type="button" role="tab" aria-selected="${state.feedType === type}" data-action="feed-nav" data-type="${type}">${label}</button>`).join('')}</div><span class="feed-label">${state.feedType === 'all' ? 'A little of everything' : `${labelFor(state.feedType)}s from the community`}</span></div>`;
}

function postCard(post) {
  const author = { username: post.username, role: post.role, avatarUrl: post.avatarName ? `/media/${encodeURIComponent(post.avatarName)}` : null };
  const content = post.type === 'idea'
    ? `<h2 class="post-title">${esc(post.title)}</h2><p class="post-body">${esc(post.body)}</p>`
    : `${post.caption ? `<p class="post-caption">${esc(post.caption)}</p>` : ''}${post.mediaUrl ? (post.type === 'video'
      ? `<video class="post-media post-media-video" controls preload="metadata" playsinline src="${esc(post.mediaUrl)}" aria-label="Video shared by ${esc(post.username)}"></video>`
      : `<img class="post-media" src="${esc(post.mediaUrl)}" alt="Picture shared by ${esc(post.username)}" loading="lazy">`) : ''}`;
  const comments = post.comments || [];
  return `<article class="post-card" data-post-id="${esc(post.id)}">
    <div class="post-head">${avatar(author)}<div class="post-author"><button class="post-author-name" type="button" data-action="open-profile" data-username="${esc(post.username)}">${esc(post.username)}</button><p class="post-time">${esc(ago(post.createdAt))}</p></div>
      <span class="post-type">${ico(post.type)}${labelFor(post.type)}</span>
      ${post.canDelete ? `<button class="post-menu" type="button" title="Remove this post" aria-label="Remove post" data-action="delete-post" data-id="${esc(post.id)}">${ico('dots')}</button>` : ''}
    </div>
    ${content}
    <section class="post-comments" aria-label="Comments on ${esc(post.type === 'idea' ? post.title : `post by ${post.username}`)}">
      <p class="comments-label">${comments.length} ${comments.length === 1 ? 'comment' : 'comments'}</p>
      ${comments.length ? `<div class="comment-list">${comments.map((comment) => `<div class="comment-row">${avatar({ username: comment.username, role: comment.role, avatarUrl: comment.avatarUrl }, 'avatar-sm')}<div class="comment-content"><div class="comment-meta"><button class="comment-author" type="button" data-action="open-profile" data-username="${esc(comment.username)}">${esc(comment.username)}</button><span class="comment-time">${esc(ago(comment.createdAt))}</span></div><p class="comment-text">${esc(comment.text)}</p></div>${comment.canDelete ? `<button class="comment-delete" type="button" data-action="delete-comment" data-id="${esc(comment.id)}">Remove</button>` : ''}</div>`).join('')}</div>` : ''}
      ${state.user ? `<form class="comment-form" data-form="comment" data-post-id="${esc(post.id)}">${avatar(state.user, 'avatar-sm')}<input class="comment-input" name="text" maxlength="1000" placeholder="Leave a thoughtful comment…" aria-label="Write a comment" required><button class="comment-submit" type="submit" aria-label="Post comment">${ico('send')}</button></form>` : `<p class="comment-signin"><button type="button" data-action="auth-login">Log in</button> to join the conversation.</p>`}
    </section>
  </article>`;
}

function emptyFeed() {
  const messages = {
    all: ['It starts with you.', 'Your feed is waiting for its first spark. Share a video, a picture, or that idea you can’t stop thinking about.'],
    video: ['Your screen, your story.', 'There are no videos here yet. Be the first to share a moment.'],
    picture: ['Catch this moment.', 'No pictures just yet. Share a little piece of your day.'],
    idea: ['Every big thing starts small.', 'Start a conversation with an idea. Someone out there might be thinking the same thing.'],
  }[state.feedType];
  return `<div class="empty-state"><span class="empty-icon">${ico(iconFor(state.feedType === 'all' ? 'idea' : state.feedType))}</span><h2 class="empty-title">${messages[0]}</h2><p class="empty-copy">${messages[1]}</p><button class="btn btn-small" type="button" data-action="${state.user ? 'compose' : 'auth-register'}">${state.user ? 'Share the first post' : 'Join ALVINCE'}</button></div>`;
}

function feedView() {
  const home = state.feedType === 'all';
  return `${home ? hero() + storyStrip() : `<div class="section-heading"><div><h1>${labelFor(state.feedType)}s</h1><p>Fresh from your ALVINCE community.</p></div></div>`}
    ${feedComposer()}${feedTabs()}<div class="post-list">${state.posts.length ? state.posts.map(postCard).join('') : emptyFeed()}</div>`;
}

function rightRail() {
  const ownPosts = state.user ? state.posts.filter((post) => post.userId === state.user.id).length : 0;
  if (!state.user) return `<aside class="right-rail"><section class="rail-card"><div class="rail-heading">Your next favorite space <span class="rail-muted">01 / 03</span></div><div class="rail-profile">${avatar(null, 'avatar-lg')}<div class="rail-profile-info"><p class="rail-profile-name">Meet ALVINCE</p><p class="rail-profile-note">A place to share your point of view.</p></div></div><p class="rail-bio">Find a welcoming corner for the photos, videos and ideas you want to put out into the world.</p><button class="btn" type="button" data-action="auth-register">Create your account ${ico('arrow')}</button></section><section class="rail-tip"><div class="rail-tip-icon">${ico('spark')}</div><h2 class="rail-tip-title">A little inspiration</h2><p class="rail-tip-text">A photo. A thought. A video your friends have to see. There’s room for all of it.</p></section><div class="rail-links"><span>ALVINCE © 2026</span><button type="button" data-action="about">About</button><span>Made for sharing</span></div></aside>`;
  const postsKnown = state.page === 'home' ? state.posts.length : state.profile?.postCount || 0;
  return `<aside class="right-rail"><section class="rail-card"><div class="rail-heading">Your space <span class="rail-muted">Good to see you</span></div><div class="rail-profile">${avatar(state.user, 'avatar-lg')}<div class="rail-profile-info"><p class="rail-profile-name">${esc(state.user.username)}</p><p class="rail-profile-note">@${esc(state.user.username)}</p></div></div><p class="rail-bio">${state.user.bio ? esc(state.user.bio) : 'Your corner of ALVINCE is all yours. Add a little bio to tell people what you’re about.'}</p><button class="btn btn-ghost btn-small" type="button" data-action="profile-me">View your profile ${ico('arrow')}</button><div class="rail-stats"><div class="rail-stat"><span class="rail-stat-number">${postsKnown}</span><span class="rail-stat-label">${state.page === 'profile' ? 'Posts on profile' : 'Posts you can see'}</span></div><div class="rail-stat"><span class="rail-stat-number">${state.user.role === 'admin' ? ico('shield') : '✦'}</span><span class="rail-stat-label">${state.user.role === 'admin' ? 'Community owner' : 'Part of ALVINCE'}</span></div></div></section><section class="rail-tip"><div class="rail-tip-icon">${ico('spark')}</div><h2 class="rail-tip-title">Start a good conversation.</h2><p class="rail-tip-text">The best communities begin with someone sharing a thought. What’s on your mind?</p></section><div class="rail-links"><span>ALVINCE © 2026</span><button type="button" data-action="about">About</button><button type="button" data-action="logout">Log out</button></div></aside>`;
}

function profileView() {
  if (!state.profile) return `<div class="empty-state"><span class="empty-icon">${ico('users')}</span><h2 class="empty-title">Finding that profile…</h2><p class="empty-copy">One moment.</p></div>`;
  const profile = state.profile;
  const user = { username: profile.username, avatarUrl: profile.avatarUrl };
  const relationshipAction = profile.relationship === 'friends' ? `<button class="btn btn-small" type="button" data-action="open-chat" data-id="${esc(profile.friendId)}">${ico('messages')} Message</button><button class="btn btn-ghost btn-small" type="button" data-action="remove-friend" data-id="${esc(profile.friendId)}">Friends ✓</button>` : profile.relationship === 'incoming' ? `<button class="btn btn-small" type="button" data-action="accept-friend" data-id="${esc(profile.friendId)}">Accept friend request</button>` : profile.relationship === 'outgoing' ? '<button class="btn btn-ghost btn-small" disabled>Request sent</button>' : state.user ? `<button class="btn btn-small" type="button" data-action="send-friend" data-id="${esc(profile.friendId)}">${ico('plus')} Add friend</button>` : `<button class="btn btn-small" type="button" data-action="auth-login">Log in to add friend</button>`;
  return `<div class="profile-cover"><div class="profile-summary">${avatar(user)}<div class="profile-name-block"><h1>${esc(profile.username)}</h1><p>On ALVINCE since ${esc(formatDate(profile.createdAt))}</p></div></div>${profile.isYou ? `<div class="profile-actions">${state.user.role === 'admin' ? `<button class="btn btn-ghost btn-small" type="button" data-action="admin">${ico('shield')} Owner dashboard</button>` : ''}<button class="btn btn-ghost btn-small" type="button" data-action="edit-profile">Edit profile</button><button class="btn btn-ghost btn-small" type="button" data-action="logout">Log out</button></div>` : `<div class="profile-actions">${relationshipAction}</div>`}</div>
    <p class="profile-bio">${profile.bio ? esc(profile.bio) : 'Still finding the words? This space is ready for a little introduction.'}</p>
    <div class="profile-tabs"><button class="profile-tab ${state.profileTab === 'posts' ? 'active' : ''}" type="button" data-action="profile-tab" data-tab="posts">Posts <span class="rail-muted">${profile.postCount}</span></button><button class="profile-tab ${state.profileTab === 'about' ? 'active' : ''}" type="button" data-action="profile-tab" data-tab="about">About</button></div>
    ${state.profileTab === 'about' ? `<div class="rail-card"><div class="rail-heading">A little about ${esc(profile.username)}</div><p class="rail-bio">${profile.bio ? esc(profile.bio) : 'This member hasn’t added a bio yet.'}</p><p class="rail-muted">Joined ${esc(formatDate(profile.createdAt))} · ${profile.postCount} ${profile.postCount === 1 ? 'post' : 'posts'}</p></div>` : (state.profilePosts.length ? `<div class="profile-grid" aria-label="Posts by ${esc(profile.username)}">${state.profilePosts.map((post) => `<button class="profile-tile ${post.type === 'idea' ? 'profile-tile-idea' : ''}" type="button" data-action="view-post" data-id="${esc(post.id)}" aria-label="View ${labelFor(post.type).toLowerCase()} post by ${esc(profile.username)}">${post.type === 'picture' ? `<img src="${esc(post.mediaUrl)}" alt="" loading="lazy">` : post.type === 'video' ? `<video src="${esc(post.mediaUrl)}" muted playsinline preload="metadata" aria-hidden="true"></video><span class="profile-tile-play">▶</span>` : `<span class="profile-tile-idea-copy"><span>${ico('idea')} IDEA</span><b>${esc(post.title)}</b><small>${esc(post.body.slice(0, 100))}</small></span>`}<span class="profile-tile-shade"></span><span class="profile-tile-badge">${ico(post.type)}</span>${post.type !== 'idea' && post.caption ? `<span class="profile-tile-caption">${esc(post.caption)}</span>` : ''}</button>`).join('')}</div>` : `<div class="empty-state"><span class="empty-icon">${ico('spark')}</span><h2 class="empty-title">Nothing here, yet.</h2><p class="empty-copy">${profile.isYou ? 'Your first post could be a picture, a video, or a bright new idea.' : 'When this member shares something, you’ll find it here.'}</p>${profile.isYou ? `<button class="btn btn-small" type="button" data-action="compose">Create a post</button>` : ''}</div>`)}
  `;
}

function friendsView() {
  return `<div class="section-heading"><div><h1>Your friends</h1><p>Add people to start a private conversation with them.</p></div><button class="btn btn-ghost btn-small" type="button" data-action="focus-search">${ico('search')} Find people</button></div>
    ${state.incomingRequests.length ? `<section class="panel community-panel"><div class="community-panel-head"><h2>Friend requests</h2><span class="nav-badge">${state.incomingRequests.length}</span></div>${state.incomingRequests.map((person) => `<div class="community-row">${avatar(person)}<div class="community-row-copy"><button class="post-author-name" data-action="open-profile" data-username="${esc(person.username)}">${esc(person.username)}</button><p class="community-muted">Wants to be friends</p></div><button class="btn btn-small" data-action="accept-request" data-id="${esc(person.id)}">Accept</button><button class="btn btn-ghost btn-small" data-action="decline-request" data-id="${esc(person.id)}">Decline</button></div>`).join('')}</section>` : ''}
    ${state.outgoingRequests.length ? `<section class="panel community-panel"><div class="community-panel-head"><h2>Sent requests</h2></div>${state.outgoingRequests.map((person) => `<div class="community-row">${avatar(person)}<div class="community-row-copy"><button class="post-author-name" data-action="open-profile" data-username="${esc(person.username)}">${esc(person.username)}</button><p class="community-muted">Request sent</p></div><button class="btn btn-ghost btn-small" data-action="cancel-request" data-id="${esc(person.id)}">Cancel</button></div>`).join('')}</section>` : ''}
    <section class="panel community-panel"><div class="community-panel-head"><h2>Friends</h2><span class="rail-muted">${state.friends.length}</span></div>${state.friends.length ? state.friends.map((person) => `<div class="community-row">${avatar(person)}<div class="community-row-copy"><button class="post-author-name" data-action="open-profile" data-username="${esc(person.username)}">${esc(person.username)}</button><p class="community-muted">${person.lastMessage ? esc(person.lastMessage) : 'You’re friends on ALVINCE'}</p></div><button class="btn btn-small" data-action="open-chat" data-id="${esc(person.id)}">${ico('messages')} Message</button></div>`).join('') : '<div class="empty-state"><span class="empty-icon">✦</span><h2 class="empty-title">Your circle starts here.</h2><p class="empty-copy">Find someone in search and send a friend request. Once they accept, you can chat.</p><button class="btn btn-small" data-action="focus-search">Find people</button></div>'}</section>`;
}

function chatFriendsListContent() {
  return `<div class="community-panel-head"><h2>Chats</h2></div>${state.messageFriends.length ? state.messageFriends.map((friend) => `<button class="chat-friend ${state.conversation?.friend.id === friend.friendId ? 'active' : ''}" data-action="open-chat" data-id="${esc(friend.friendId)}">${avatar(friend)}<span class="chat-friend-copy"><b>${esc(friend.username)}</b><small>${esc(friend.lastMessage || 'Start a conversation')}</small></span>${friend.unread ? `<span class="chat-unread">${friend.unread}</span>` : ''}</button>`).join('') : '<p class="chat-empty-list">Add a friend to start chatting.</p>'}`;
}

function chatMessagesContent(messages) {
  return messages.length ? messages.map((message) => `<div class="chat-message ${message.senderId === state.user.id ? 'mine' : ''}"><p>${esc(message.text)}</p><time>${esc(ago(message.createdAt))}</time></div>`).join('') : '<div class="chat-first">Say hello to start the conversation.</div>';
}

function messagesView() {
  const active = state.conversation;
  return `<div class="messages-page ${active ? 'has-conversation' : ''}"><div class="section-heading messages-heading"><div><h1>Messages</h1><p>Your conversations are saved so you can come back to them.</p></div></div><div class="messages-layout ${active ? 'has-conversation' : ''}"><aside class="panel chat-friends">${chatFriendsListContent()}</aside><section class="panel chat-panel">${active ? `<header class="chat-head"><button class="chat-back" type="button" data-action="messages-back" aria-label="Back to chats">${ico('arrow')}</button>${avatar(active.friend)}<div class="chat-head-copy"><button class="post-author-name" data-action="open-profile" data-username="${esc(active.friend.username)}">${esc(active.friend.username)}</button><p class="community-muted">Friend conversation</p></div></header><div class="chat-messages" data-chat-messages>${chatMessagesContent(active.messages)}</div><div class="chat-typing" data-chat-typing role="status" aria-live="polite" ${active.typing ? '' : 'hidden'}><span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>${esc(active.friend.username)} is typing</span></div><form class="chat-compose" data-form="message"><input name="text" maxlength="2000" placeholder="Write a message…" aria-label="Write a message" required autocomplete="off"><button class="btn" type="submit" aria-label="Send message">${ico('send')}</button></form>` : `<div class="chat-welcome"><span class="empty-icon">${ico('messages')}</span><h2 class="empty-title">Your messages</h2><p class="empty-copy">Choose a friend to open your conversation.</p></div>`}</section></div></div>`;
}

function storyComposerModal() {
  return `<div class="modal-backdrop" data-action="backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="story-title"><header class="modal-head"><div><p class="modal-kicker">SHARE A LITTLE MOMENT</p><h2 class="modal-title" id="story-title">Add to your story.</h2><p class="modal-subtitle">Visible to the community for 24 hours.</p></div><button class="modal-close" type="button" data-action="close-modal">×</button></header><div class="modal-body"><form data-form="story"><div class="field"><label for="story-media">Picture or video</label><input class="file-input" id="story-media" name="media" type="file" data-input="story-file" accept=".jpg,.jpeg,.png,.webp,.gif,.avif,.mp4,.webm,.mov,image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime" ${state.storyFile ? '' : 'required'}><p class="field-hint">JPG, PNG, WebP, GIF, AVIF, MP4, WebM or iPhone MOV. Pictures up to 12 MB; videos up to 50 MB.</p><p class="upload-file-name" data-story-file-name>${state.storyFile ? esc(state.storyFile.name) : 'No file selected yet'}</p></div><div class="field"><label for="story-caption">Caption <span class="rail-muted">(optional)</span></label><textarea id="story-caption" name="caption" maxlength="200" placeholder="Add a few words…">${esc(state.storyCaption)}</textarea></div><button class="btn modal-submit" type="submit" ${state.uploading ? 'disabled' : ''}>${state.uploading ? 'Uploading…' : 'Share story'} ${ico('arrow')}</button></form></div></section></div>`;
}

function storyViewerModal() {
  const story = state.stories[state.storyIndex];
  if (!story) return '';
  const media = story.mediaType.startsWith('video/') ? `<video class="story-viewer-media" src="${esc(story.mediaUrl)}" autoplay controls playsinline></video>` : `<img class="story-viewer-media" src="${esc(story.mediaUrl)}" alt="Story shared by ${esc(story.username)}">`;
  return `<div class="story-viewer-backdrop"><section class="story-viewer" role="dialog" aria-modal="true" aria-label="Story by ${esc(story.username)}"><div class="story-viewer-progress"><span></span></div><header class="story-viewer-head">${avatar(story, 'avatar-sm')}<div><b>${esc(story.username)}</b><small>${esc(ago(story.createdAt))}</small></div>${story.isYou ? `<button class="story-delete" data-action="delete-story" data-id="${esc(story.id)}">Delete</button>` : ''}<button class="story-close" data-action="close-modal" aria-label="Close story">×</button></header>${media}${story.caption ? `<p class="story-viewer-caption">${esc(story.caption)}</p>` : ''}<button class="story-nav story-prev" data-action="story-prev" aria-label="Previous story">‹</button><button class="story-nav story-next" data-action="story-next" aria-label="Next story">›</button><p class="story-counter">${state.storyIndex + 1} / ${state.stories.length}</p></section></div>`;
}

function postDetailModal() {
  const post = state.selectedPostId ? [...state.posts, ...state.profilePosts, ...state.adminPosts].find((item) => item.id === state.selectedPostId) : null;
  if (!post) return '';
  return `<div class="modal-backdrop" data-action="backdrop"><section class="modal modal-wide" role="dialog" aria-modal="true" aria-label="Post by ${esc(post.username)}"><header class="modal-head post-detail-head"><div><p class="modal-kicker">${labelFor(post.type).toUpperCase()} · ALVINCE COMMUNITY</p><h2 class="modal-title">A post by @${esc(post.username)}</h2></div><button class="modal-close" type="button" data-action="close-modal" aria-label="Close post">×</button></header><div class="modal-body post-detail-body">${postCard(post)}</div></section></div>`;
}

function adminView() {
  return `<div class="section-heading"><div><h1>Owner dashboard</h1><p>A simple place to keep the ALVINCE community healthy.</p></div><span class="post-type">${ico('shield')} Admin only</span></div>
    <div class="admin-switch" role="tablist" aria-label="Admin section"><button type="button" role="tab" aria-selected="${state.adminTab === 'users'}" class="${state.adminTab === 'users' ? 'active' : ''}" data-action="admin-tab" data-tab="users">Members (${state.adminUsers.length})</button><button type="button" role="tab" aria-selected="${state.adminTab === 'posts'}" class="${state.adminTab === 'posts' ? 'active' : ''}" data-action="admin-tab" data-tab="posts">Posts (${state.adminPosts.length})</button></div>
    <section class="panel">${state.adminTab === 'users' ? (state.adminUsers.length ? state.adminUsers.map((user) => `<div class="admin-user">${avatar(user)}<div class="admin-user-copy"><p class="admin-user-name">${esc(user.username)}${user.role === 'admin' ? '<span class="admin-role">Owner</span>' : ''}${user.disabled ? '<span class="admin-status">Paused</span>' : ''}</p><p class="admin-user-meta">${esc(user.email)} · ${user.postCount} ${user.postCount === 1 ? 'post' : 'posts'} · Joined ${esc(ago(user.createdAt))}</p></div>${user.role !== 'admin' ? `<button class="btn btn-small ${user.disabled ? 'btn-ghost' : 'btn-danger'}" type="button" data-action="toggle-user" data-id="${esc(user.id)}">${user.disabled ? 'Restore' : 'Pause account'}</button>` : '<span class="admin-status">Protected</span>'}</div>`).join('') : '<p class="admin-empty">No members yet.</p>') : (state.adminPosts.length ? state.adminPosts.map((post) => `<div class="admin-post-row"><span class="admin-post-type">${ico(post.type)}</span><div class="admin-post-copy"><p class="admin-post-title">${esc(post.type === 'idea' ? post.title : post.caption || `${labelFor(post.type)} shared by @${post.username}`)}</p><p class="admin-post-meta">${labelFor(post.type)} · @${esc(post.username)} · ${post.comments.length} ${post.comments.length === 1 ? 'comment' : 'comments'}</p></div><button class="btn btn-small btn-danger" type="button" data-action="delete-post" data-id="${esc(post.id)}">Remove</button></div>`).join('') : '<p class="admin-empty">There are no posts to moderate yet.</p>')}</section>
    <p class="feed-label admin-disclaimer">Removing a post also removes its comments and stored media. Pausing an account signs its owner out.</p>`;
}

function searchPopover() {
  const results = state.searchResults;
  if (!state.searchQuery.trim()) return '';
  if (!results) return `<div class="search-popover"><p class="search-popover-foot">Searching ALVINCE…</p></div>`;
  if (results.error) return `<div class="search-popover"><p class="search-popover-foot">Search couldn’t load. Please try again.</p></div>`;
  const hasItems = results.users.length || results.posts.length;
  return `<div class="search-popover" role="region" aria-label="Search results">${results.users.length ? `<div class="search-popover-heading">People</div>${results.users.map((user) => `<button class="search-result" type="button" data-action="open-profile" data-username="${esc(user.username)}">${avatar({ username: user.username, avatarUrl: user.avatarUrl }, 'avatar-sm')}<span class="search-result-copy"><span class="search-result-title">@${esc(user.username)}</span><span class="search-result-sub">${esc(user.bio || 'ALVINCE community member')}</span></span></button>`).join('')}` : ''}${results.posts.length ? `<div class="search-popover-heading">Posts</div>${results.posts.slice(0, 5).map((post) => `<button class="search-result" type="button" data-action="open-search-post" data-post-id="${esc(post.id)}"><span class="admin-post-type">${ico(post.type)}</span><span class="search-result-copy"><span class="search-result-title">${esc(post.type === 'idea' ? post.title : post.caption || `${labelFor(post.type)} by @${post.username}`)}</span><span class="search-result-sub">${labelFor(post.type)} by @${esc(post.username)}</span></span></button>`).join('')}` : ''}${!hasItems ? '<p class="search-popover-foot">No people or posts found. Try another search.</p>' : '<p class="search-popover-foot">People and posts matching your search</p>'}</div>`;
}

function mobileNav() {
  const active = currentNav();
  return `<nav class="mobile-bottom-nav" aria-label="Mobile navigation"><button class="mobile-nav-link ${active === 'home' ? 'active' : ''}" type="button" data-action="feed-nav" data-type="all">${ico('home')}<span>Home</span></button><button class="mobile-nav-link ${active === 'friends' ? 'active' : ''}" type="button" data-action="friends">${ico('users')}<span>Friends</span></button><button class="mobile-nav-link mobile-nav-create" type="button" data-action="${state.user ? 'compose' : 'auth-register'}" aria-label="Create post">${ico('plus')}</button><button class="mobile-nav-link ${active === 'messages' ? 'active' : ''}" type="button" data-action="messages">${ico('messages')}<span>Messages</span></button><button class="mobile-nav-link ${active === 'profile' ? 'active' : ''}" type="button" data-action="profile-me">${avatar(state.user, 'avatar-sm')}<span>Profile</span></button></nav>`;
}

function authModal() {
  const register = state.authMode === 'register';
  return `<div class="modal-backdrop" data-action="backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="auth-title"><header class="modal-head"><div><div class="auth-logo"><span class="brand-mark">A</span> ALVINCE</div><p class="modal-kicker">${register ? 'YOUR COMMUNITY IS WAITING' : 'GOOD TO HAVE YOU BACK'}</p><h2 class="modal-title" id="auth-title">${register ? 'Create your space.' : 'Welcome back.'}</h2><p class="modal-subtitle">${register ? 'Pick your name. Bring what you’ve got.' : 'Log in and pick up where you left off.'}</p></div><button class="modal-close" type="button" data-action="close-modal" aria-label="Close">×</button></header>
      <div class="modal-body">${state.authError ? `<p class="form-alert" role="alert">${esc(state.authError)}</p>` : ''}<form data-form="auth" autocomplete="on">
        ${register ? `<div class="field"><label for="auth-username">Username</label><input id="auth-username" name="username" minlength="3" maxlength="20" pattern="[A-Za-z0-9][A-Za-z0-9_.]{1,18}[A-Za-z0-9]" autocomplete="username" placeholder="e.g. alvinceuser" required></div><div class="field"><label for="auth-email">Email</label><input id="auth-email" type="email" name="email" maxlength="254" autocomplete="email" placeholder="you@example.com" required></div>` : `<div class="field"><label for="auth-identity">Username or email</label><input id="auth-identity" name="identity" autocomplete="username" placeholder="Your username or email" required></div>`}
        <div class="field"><label for="auth-password">Password</label><input id="auth-password" type="password" name="password" minlength="10" maxlength="128" autocomplete="${register ? 'new-password' : 'current-password'}" placeholder="${register ? 'At least 10 characters' : 'Your password'}" required></div>
        <button class="btn modal-submit" type="submit">${register ? 'Create my account' : 'Log in'} ${ico('arrow')}</button>
      </form><div class="modal-divider">YOUR NEXT CHAPTER STARTS HERE</div><p class="auth-switch">${register ? 'Already one of us?' : 'New to ALVINCE?'} <button type="button" data-action="auth-switch">${register ? 'Log in' : 'Create an account'}</button></p></div></section></div>`;
}

function composeModal() {
  const isIdea = state.composeType === 'idea';
  const accept = state.composeType === 'video' ? '.mp4,.webm,.mov,video/mp4,video/webm,video/quicktime' : '.jpg,.jpeg,.png,.webp,.gif,.avif,image/jpeg,image/png,image/webp,image/gif,image/avif';
  const preview = state.previewUrl ? (state.composeType === 'picture' ? `<img class="upload-preview" src="${esc(state.previewUrl)}" alt="Upload preview">` : `<video class="upload-preview" src="${esc(state.previewUrl)}" controls muted aria-label="Video preview"></video>`) : '';
  const progress = state.uploadProgress === null ? '' : `<progress class="upload-progress" max="100" value="${state.uploadProgress}" aria-label="Upload progress"></progress>`;
  return `<div class="modal-backdrop" data-action="backdrop"><section class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="compose-title"><header class="modal-head"><div><p class="modal-kicker">MAKE SOMETHING OF IT</p><h2 class="modal-title" id="compose-title">Create a post.</h2><p class="modal-subtitle">Your little corner of the community is listening.</p></div><button class="modal-close" type="button" data-action="close-modal" aria-label="Close">×</button></header>
      <div class="modal-tabs" role="tablist" aria-label="Choose a post type">${[['video', 'Video'], ['picture', 'Picture'], ['idea', 'Idea']].map(([type, label]) => `<button class="modal-tab ${state.composeType === type ? 'active' : ''}" type="button" role="tab" aria-selected="${state.composeType === type}" data-action="compose-type" data-type="${type}">${ico(type)}${label}</button>`).join('')}</div>
      <div class="modal-body"><form data-form="compose">
        ${isIdea ? `<div class="field"><label for="idea-title">Give your idea a name</label><input id="idea-title" name="title" maxlength="100" placeholder="The thing you can’t stop thinking about…" required></div><div class="field"><label for="idea-body">Put it into words</label><textarea id="idea-body" name="body" maxlength="8000" placeholder="Tell us a little more. What’s on your mind?" required></textarea></div><p class="field-hint">A clear idea makes a great conversation.</p>` : `<label class="upload-drop ${state.selectedFile ? 'has-file' : ''}" for="media-file"><span class="upload-icon">${ico('upload')}</span><span class="upload-label">${state.selectedFile ? 'Change your file' : `Choose a ${state.composeType === 'picture' ? 'picture' : 'video'}`}</span><span class="upload-hint">${state.composeType === 'picture' ? 'JPG, PNG, WebP, GIF or AVIF · up to 12 MB' : 'MP4, WebM or iPhone MOV · up to 50 MB'}</span>${state.selectedFile ? `<span class="upload-file-name">${esc(state.selectedFile.name)}</span>` : ''}${preview}<input id="media-file" name="media" type="file" accept="${accept}" data-input="media-file" ${state.selectedFile ? '' : 'required'}></label><div class="field compose-caption"><label for="post-caption">Add a caption <span class="rail-muted">(optional)</span></label><textarea id="post-caption" name="caption" maxlength="500" placeholder="Give it a little context…" rows="2"></textarea></div>`}
        ${progress}<div class="upload-submit-row"><p class="upload-size-note">Shared with the ALVINCE community.</p><button class="btn" type="submit" ${state.uploading ? 'disabled' : ''}>${state.uploading ? 'Publishing…' : 'Publish'} ${ico('arrow')}</button></div></form></div></section></div>`;
}

function editProfileModal() {
  const draft = state.profileDraft || { username: state.user.username, bio: state.user.bio || '' };
  return `<div class="modal-backdrop" data-action="backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="edit-title"><header class="modal-head"><div><p class="modal-kicker">A LITTLE MORE YOU</p><h2 class="modal-title" id="edit-title">Edit your profile.</h2><p class="modal-subtitle">Make yourself right at home.</p></div><button class="modal-close" type="button" data-action="close-modal" aria-label="Close">×</button></header><div class="modal-body"><form data-form="edit-profile"><div class="profile-photo-edit">${avatar(state.user, 'avatar-lg')}<label class="btn btn-ghost btn-small" for="avatar-file">Change profile photo</label><input class="file-input" id="avatar-file" type="file" data-input="avatar-file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif">${state.avatarFile ? `<span class="community-muted">${esc(state.avatarFile.name)}</span>` : '<span class="community-muted">JPG, PNG, WebP, GIF or AVIF · up to 12 MB</span>'}</div><div class="field"><label for="profile-username">Username</label><input id="profile-username" name="username" minlength="3" maxlength="20" value="${esc(draft.username)}" required></div><div class="field"><label for="profile-bio">A few words about you</label><textarea id="profile-bio" name="bio" maxlength="240" placeholder="What are you into?">${esc(draft.bio)}</textarea></div><p class="field-hint">Up to 240 characters.</p><button class="btn modal-submit" type="submit">Save changes ${ico('arrow')}</button></form></div></section></div>`;
}

function modalHtml() {
  if (state.modal === 'auth') return authModal();
  if (state.modal === 'compose') return composeModal();
  if (state.modal === 'edit-profile') return editProfileModal();
  if (state.modal === 'story-create') return storyComposerModal();
  if (state.modal === 'story-view') return storyViewerModal();
  if (state.modal === 'post-detail') return postDetailModal();
  if (state.modal === 'about') return `<div class="modal-backdrop" data-action="backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="about-title"><header class="modal-head"><div><p class="modal-kicker">MADE FOR SHARING</p><h2 class="modal-title" id="about-title">ALVINCE is yours.</h2><p class="modal-subtitle">A place for the things you want to put out into the world.</p></div><button class="modal-close" type="button" data-action="close-modal" aria-label="Close">×</button></header><div class="modal-body"><p class="rail-bio">Share your videos, pictures and ideas. Find people who get you. Be part of something that’s always growing.</p><button class="btn modal-submit" type="button" data-action="${state.user ? 'compose' : 'auth-register'}">${state.user ? 'Share something' : 'Join ALVINCE'} ${ico('arrow')}</button></div></section></div>`;
  return '';
}

function render() {
  document.body.classList.toggle('theme-dark', state.theme === 'dark');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', state.theme === 'dark' ? '#14121b' : '#f8f6fb');
  const main = state.page === 'profile' ? profileView() : state.page === 'admin' ? adminView() : state.page === 'friends' ? friendsView() : state.page === 'messages' ? messagesView() : feedView();
  app.classList.toggle('is-messages', state.page === 'messages');
  app.innerHTML = `${contactsSidebar()}<main class="main-area">${topbar()}<div class="page-content"><div class="feed-layout"><section class="feed-column">${main}</section>${rightRail()}</div></div></main>${mobileNav()}${modalHtml()}`;
  if (state.page === 'messages' && state.user) startMessageSync();
  else stopMessageSync();
}

function notify(message, error = false) {
  const toast = document.createElement('div');
  toast.className = `toast${error ? ' error' : ''}`;
  toast.textContent = message;
  toastRegion.append(toast);
  setTimeout(() => toast.remove(), 3600);
}

async function deleteStory(id) {
  try {
    await api(`/api/stories/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const result = await api('/api/stories'); state.stories = result.stories; state.modal = null; render(); notify('Your story has been removed.');
  } catch (error) { notify(error.message, true); }
}

function resetCompose() {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.modal = null; state.selectedPostId = null; state.selectedFile = null; state.previewUrl = null; state.uploadProgress = null; state.uploading = false; state.authError = '';
}

function setRoute({ profile, admin = false, page = 'home', feedType = 'all' } = {}, push = true) {
  const params = new URLSearchParams();
  if (profile) params.set('profile', profile);
  else if (admin) params.set('admin', '1');
  else if (page === 'friends' || page === 'messages') params.set('page', page);
  else if (feedType !== 'all') params.set('feed', feedType);
  const suffix = params.size ? `?${params}` : '';
  const route = `${location.pathname}${suffix}${location.hash}`;
  if (push && `${location.pathname}${location.search}${location.hash}` !== route) history.pushState({}, '', route);
}

async function loadFeed() {
  try {
    const [result, storyResult] = await Promise.all([api(`/api/feed?type=${encodeURIComponent(state.feedType)}`), api('/api/stories')]);
    state.posts = result.posts;
    state.stories = storyResult.stories;
    if (state.page === 'home') render();
  } catch (error) { notify(error.message, true); }
}

async function refreshCommunityData() {
  if (!state.user) { state.friends = []; state.incomingRequests = []; state.outgoingRequests = []; state.messageFriends = []; return; }
  try {
    const [friends, messages] = await Promise.all([api('/api/friends'), api('/api/messages')]);
    state.friends = friends.friends; state.incomingRequests = friends.incoming; state.outgoingRequests = friends.outgoing;
    state.messageFriends = messages.friends;
  } catch { /* Keep the rest of the signed-in space usable if community data is unavailable. */ }
}

function startMessageSync() {
  if (!messageSyncTimer) messageSyncTimer = window.setInterval(syncMessagePage, 1800);
}

function stopMessageSync() {
  if (messageSyncTimer) window.clearInterval(messageSyncTimer);
  messageSyncTimer = null;
}

async function syncMessagePage() {
  if (!state.user || state.page !== 'messages' || document.hidden || messageSyncInFlight) return;
  const friendId = state.activeConversationId;
  if (friendId && !state.conversation) return;
  const epoch = messageSyncEpoch;
  messageSyncInFlight = true;
  try {
    const [overview, chat] = await Promise.all([
      api('/api/messages'),
      friendId ? api(`/api/messages/${encodeURIComponent(friendId)}`) : Promise.resolve(null),
    ]);
    if (epoch !== messageSyncEpoch || state.page !== 'messages' || state.activeConversationId !== friendId) return;
    state.messageFriends = overview.friends;
    if (chat) {
      const previousMessages = state.conversation?.messages || [];
      const previousLastId = previousMessages.at(-1)?.id;
      const nextLastId = chat.messages.at(-1)?.id;
      const thread = app.querySelector('[data-chat-messages]');
      const nearBottom = !thread || thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
      const messagesChanged = previousMessages.length !== chat.messages.length || previousLastId !== nextLastId;
      state.conversation = { friend: chat.friend, messages: chat.messages, typing: chat.typing };
      if (thread && messagesChanged) {
        thread.innerHTML = chatMessagesContent(chat.messages);
        if (nearBottom || previousLastId !== nextLastId) thread.scrollTop = thread.scrollHeight;
      }
      const typing = app.querySelector('[data-chat-typing]');
      if (typing) typing.hidden = !chat.typing;
    }
    const friendsList = app.querySelector('.chat-friends');
    if (friendsList) {
      const scrollTop = friendsList.scrollTop;
      friendsList.innerHTML = chatFriendsListContent();
      friendsList.scrollTop = scrollTop;
    }
  } catch { /* Chat stays usable during a brief network interruption; the next poll retries. */ }
  finally { messageSyncInFlight = false; }
}

async function loadFriends({ push = true } = {}) {
  if (!state.user) { openAuth('login'); return; }
  if (push) setRoute({ page: 'friends' });
  state.page = 'friends'; state.searchOpen = false; render();
  try { const result = await api('/api/friends'); state.friends = result.friends; state.incomingRequests = result.incoming; state.outgoingRequests = result.outgoing; render(); }
  catch (error) { notify(error.message, true); }
}

async function loadMessages(friendId = null, { push = true } = {}) {
  if (!state.user) { openAuth('login'); return; }
  if (state.activeConversationId && state.activeConversationId !== friendId) stopTyping(state.activeConversationId);
  if (state.activeConversationId !== friendId) { clearTimeout(typingStopTimer); typingStopTimer = null; lastTypingPingAt = 0; }
  messageSyncEpoch += 1;
  if (push) setRoute({ page: 'messages' });
  state.page = 'messages'; state.activeConversationId = friendId || null; state.conversation = null; state.searchOpen = false; render();
  try {
    const result = await api('/api/messages'); state.messageFriends = result.friends;
    if (friendId) {
      const chat = await api(`/api/messages/${encodeURIComponent(friendId)}`);
      state.conversation = { friend: chat.friend, messages: chat.messages, typing: chat.typing };
      await refreshCommunityData();
    }
    render();
    const area = app.querySelector('[data-chat-messages]'); if (area) area.scrollTop = area.scrollHeight;
  } catch (error) { notify(error.message, true); }
}

async function sendTypingSignal(friendId, active) {
  if (!friendId || !state.user) return;
  try { await api(`/api/messages/${encodeURIComponent(friendId)}/typing`, { method: 'POST', json: { active } }); }
  catch { /* Typing presence is temporary and should never block chat. */ }
}

function stopTyping(friendId = state.activeConversationId) {
  clearTimeout(typingStopTimer); typingStopTimer = null; lastTypingPingAt = 0;
  if (friendId) void sendTypingSignal(friendId, false);
}

function noteTyping(input) {
  const friendId = state.activeConversationId;
  if (!state.user || !friendId) return;
  clearTimeout(typingStopTimer);
  if (!input.value.trim()) { stopTyping(friendId); return; }
  const now = Date.now();
  if (now - lastTypingPingAt >= 950) {
    lastTypingPingAt = now;
    void sendTypingSignal(friendId, true);
  }
  typingStopTimer = window.setTimeout(() => stopTyping(friendId), 1700);
}

async function refreshProfile() {
  if (state.profile) {
    const result = await api(`/api/profile?username=${encodeURIComponent(state.profile.username)}`);
    state.profile = result.profile; state.profilePosts = result.posts;
  }
  await refreshCommunityData(); render();
}

async function handleFriendAction(action, id) {
  try {
    if (action === 'send-friend') await api(`/api/friends/request/${encodeURIComponent(id)}`, { method: 'POST', json: {} });
    if (action === 'accept-friend') {
      const incoming = state.incomingRequests.find((request) => request.userId === id || request.id === id);
      if (!incoming) throw new Error('That friend request is no longer available.');
      await api(`/api/friends/requests/${encodeURIComponent(incoming.id)}/accept`, { method: 'POST', json: {} });
    }
    if (action === 'cancel-friend' || action === 'decline-request' || action === 'cancel-request') {
      const request = [...state.incomingRequests, ...state.outgoingRequests].find((item) => item.id === id);
      if (request) await api(`/api/friends/requests/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }
    if (action === 'remove-friend') {
      if (!confirm('Remove this friend? You can send another request later.')) return;
      await api(`/api/friends/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }
    await refreshCommunityData();
    if (state.page === 'profile' && state.profile) {
      const result = await api(`/api/profile?username=${encodeURIComponent(state.profile.username)}`); state.profile = result.profile; state.profilePosts = result.posts;
    }
    render(); notify(action === 'send-friend' ? 'Friend request sent.' : action === 'remove-friend' ? 'Friend removed.' : 'Your friend list is updated.');
  } catch (error) { notify(error.message, true); }
}

async function submitMessage(form) {
  const text = form.elements.text.value.trim(); if (!text || !state.activeConversationId) return;
  const button = form.querySelector('button[type="submit"]'); button.disabled = true;
  stopTyping(state.activeConversationId);
  try {
    await api(`/api/messages/${encodeURIComponent(state.activeConversationId)}`, { method: 'POST', json: { text } });
    await loadMessages(state.activeConversationId, { push: false });
  } catch (error) { button.disabled = false; notify(error.message, true); }
}

async function submitStory(form) {
  if (!state.storyFile) { notify('Choose a picture or video for your story.', true); return; }
  const caption = form.elements.caption.value.trim();
  state.uploading = true; render();
  const body = new FormData(); body.set('media', state.storyFile, state.storyFile.name); body.set('caption', caption);
  try {
    await api('/api/stories', { method: 'POST', body });
    state.modal = null; state.storyFile = null; state.storyCaption = ''; state.uploading = false;
    const result = await api('/api/stories'); state.stories = result.stories;
    await refreshCommunityData(); render(); notify('Your story is live for 24 hours.');
  } catch (error) { state.uploading = false; state.storyCaption = caption; render(); notify(error.message, true); }
}

async function loadProfile(username, { push = true } = {}) {
  if (push) setRoute({ profile: username });
  state.page = 'profile'; state.profile = null; state.profilePosts = []; state.profileTab = 'posts'; state.searchOpen = false;
  render();
  try {
    const result = await api(`/api/profile?username=${encodeURIComponent(username)}`);
    state.profile = result.profile; state.profilePosts = result.posts; render();
  } catch (error) { state.page = 'home'; setRoute({ feedType: 'all' }, false); render(); notify(error.message, true); }
}

async function loadAdmin({ push = true } = {}) {
  if (push) setRoute({ admin: true });
  state.page = 'admin'; state.adminLoaded = false; state.searchOpen = false; render();
  try {
    const [users, posts] = await Promise.all([api('/api/admin/users'), api('/api/admin/posts')]);
    state.adminUsers = users.users; state.adminPosts = posts.posts; state.adminLoaded = true; render();
  } catch (error) { state.page = 'home'; setRoute({ feedType: 'all' }, false); render(); notify(error.message, true); }
}

async function goFeed(type = 'all', { push = true } = {}) {
  if (push) setRoute({ feedType: type });
  state.page = 'home'; state.feedType = type; state.searchOpen = false; render(); await loadFeed();
}

function openPost(postId) {
  state.selectedPostId = postId; state.modal = 'post-detail'; render();
}

async function openAuth(mode = 'login') {
  state.authMode = mode; state.authError = ''; state.modal = 'auth'; state.searchOpen = false; render();
  requestAnimationFrame(() => app.querySelector(mode === 'register' ? '#auth-username' : '#auth-identity')?.focus());
}

function openCompose(type = 'video') {
  if (!state.user) { openAuth('register'); return; }
  resetCompose(); state.composeType = type; state.modal = 'compose'; render();
}

function navigateAction(action, target) {
  switch (action) {
    case 'navigate': goFeed('all'); break;
    case 'feed-nav': goFeed(target.dataset.type); break;
    case 'friends': loadFriends(); break;
    case 'messages': loadMessages(); break;
    case 'messages-back': loadMessages(null, { push: false }); break;
    case 'open-chat': loadMessages(target.dataset.id); break;
    case 'profile-me': if (state.user) loadProfile(state.user.username); else openAuth('login'); break;
    case 'open-profile': loadProfile(target.dataset.username); break;
    case 'compose': openCompose(); break;
    case 'auth-login': openAuth('login'); break;
    case 'auth-register': openAuth('register'); break;
    case 'auth-switch': openAuth(state.authMode === 'login' ? 'register' : 'login'); break;
    case 'close-modal': resetCompose(); render(); break;
    case 'theme': state.theme = state.theme === 'light' ? 'dark' : 'light'; localStorage.setItem('alvince-theme', state.theme); render(); break;
    case 'edit-profile': state.profileDraft = { username: state.user.username, bio: state.user.bio || '' }; state.avatarFile = null; state.authError = ''; state.modal = 'edit-profile'; render(); break;
    case 'story-create': if (!state.user) openAuth('login'); else { state.storyFile = null; state.storyCaption = ''; state.modal = 'story-create'; render(); } break;
    case 'view-story': state.storyIndex = Number(target.dataset.index) || 0; state.modal = 'story-view'; render(); break;
    case 'story-prev': state.storyIndex = (state.storyIndex - 1 + state.stories.length) % state.stories.length; render(); break;
    case 'story-next': state.storyIndex = (state.storyIndex + 1) % state.stories.length; render(); break;
    case 'delete-story': deleteStory(target.dataset.id); break;
    case 'send-friend': case 'accept-friend': case 'remove-friend': handleFriendAction(action, target.dataset.id); break;
    case 'accept-request': handleFriendAction('accept-friend', target.dataset.id); break;
    case 'decline-request': case 'cancel-request': case 'cancel-friend': handleFriendAction(action, target.dataset.id); break;
    case 'focus-search': app.querySelector('#global-search')?.focus(); break;
    case 'admin': loadAdmin(); break;
    case 'about': state.modal = 'about'; render(); break;
    case 'profile-tab': state.profileTab = target.dataset.tab; render(); break;
    case 'view-post': openPost(target.dataset.id); break;
    case 'admin-tab': state.adminTab = target.dataset.tab; render(); break;
    case 'compose-type':
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
      state.previewUrl = null; state.selectedFile = null; state.composeType = target.dataset.type; render(); break;
    case 'logout': signOut(); break;
    case 'toggle-user': toggleUser(target.dataset.id); break;
    case 'delete-post': deletePost(target.dataset.id); break;
    case 'delete-comment': deleteComment(target.dataset.id); break;
    case 'open-search-post': focusSearchPost(target.dataset.postId); break;
  }
}

async function signOut() {
  try { await api('/api/auth/logout', { method: 'POST' }); }
  catch (error) { notify(error.message, true); return; }
  state.user = null; state.csrfToken = null; state.page = 'home'; state.feedType = 'all'; state.modal = null; state.searchResults = null;
  state.friends = []; state.messageFriends = []; state.incomingRequests = []; state.outgoingRequests = []; state.conversation = null;
  setRoute({ feedType: 'all' }); state.profile = null;
  await loadFeed(); render(); notify('You’re logged out. See you again soon.');
}

async function submitAuth(form) {
  const values = Object.fromEntries(new FormData(form));
  const endpoint = state.authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const result = await api(endpoint, { method: 'POST', json: values });
    state.user = result.user; state.csrfToken = result.csrfToken; state.modal = null; state.authError = '';
    state.page = 'home'; state.feedType = 'all';
    setRoute({ feedType: 'all' });
    await refreshCommunityData();
    await loadFeed(); render(); notify(state.authMode === 'register' ? `Welcome to ALVINCE, ${state.user.username}.` : 'You’re back. Good to see you.');
  } catch (error) {
    state.authError = error.message; render();
    requestAnimationFrame(() => app.querySelector(state.authMode === 'register' ? '#auth-username' : '#auth-identity')?.focus());
  }
}

function xhrUpload(form) {
  if (state.uploading) return;
  const formData = new FormData();
  formData.set('type', state.composeType);
  if (state.composeType === 'idea') {
    formData.set('title', form.elements.title.value.trim());
    formData.set('body', form.elements.body.value.trim());
  } else {
    formData.set('caption', form.elements.caption.value.trim());
    if (state.selectedFile) formData.set('media', state.selectedFile, state.selectedFile.name);
  }
  state.uploading = true; state.uploadProgress = 0; render();
  const request = new XMLHttpRequest();
  request.open('POST', '/api/posts'); request.withCredentials = true;
  if (state.csrfToken) request.setRequestHeader('X-CSRF-Token', state.csrfToken);
  request.upload.addEventListener('progress', (event) => {
    if (event.lengthComputable) {
      state.uploadProgress = Math.round(event.loaded / event.total * 100);
      const progress = app.querySelector('.upload-progress');
      if (progress) progress.value = state.uploadProgress;
    }
  });
  request.addEventListener('load', async () => {
    let result = {};
    try { result = JSON.parse(request.responseText); } catch { /* Server returned no JSON. */ }
    if (request.status >= 200 && request.status < 300) {
      resetCompose(); state.page = 'home'; state.feedType = 'all'; await loadFeed(); render(); notify('Your post is out there.');
    } else {
      state.uploading = false; state.uploadProgress = null; state.modal = 'compose'; render(); notify(result.error || 'Your post could not be published.', true);
    }
  });
  request.addEventListener('error', () => { state.uploading = false; state.uploadProgress = null; state.modal = 'compose'; render(); notify('The connection dropped. Please try again.', true); });
  request.send(formData);
}

async function submitComment(form) {
  const text = form.elements.text.value.trim();
  if (!text) return;
  const submit = form.querySelector('button[type="submit"]'); submit.disabled = true;
  try {
    await api(`/api/posts/${encodeURIComponent(form.dataset.postId)}/comments`, { method: 'POST', json: { text } });
    await refreshVisiblePosts();
  } catch (error) { submit.disabled = false; notify(error.message, true); }
}

async function refreshVisiblePosts() {
  if (state.page === 'profile' && state.profile) {
    const result = await api(`/api/profile?username=${encodeURIComponent(state.profile.username)}`);
    state.profile = result.profile; state.profilePosts = result.posts; render(); return;
  }
  if (state.page === 'admin') {
    const [users, posts] = await Promise.all([api('/api/admin/users'), api('/api/admin/posts')]);
    state.adminUsers = users.users; state.adminPosts = posts.posts; render(); return;
  }
  await loadFeed();
}

async function deletePost(id) {
  if (!confirm('Remove this post and all its comments?')) return;
  try {
    await api(`/api/posts/${encodeURIComponent(id)}`, { method: 'DELETE' }); await refreshVisiblePosts();
    if (state.selectedPostId === id) { state.selectedPostId = null; state.modal = null; render(); }
    notify('The post has been removed.');
  }
  catch (error) { notify(error.message, true); }
}

async function deleteComment(id) {
  if (!confirm('Remove this comment?')) return;
  try { await api(`/api/comments/${encodeURIComponent(id)}`, { method: 'DELETE' }); await refreshVisiblePosts(); notify('The comment has been removed.'); }
  catch (error) { notify(error.message, true); }
}

async function toggleUser(id) {
  try {
    const result = await api(`/api/admin/users/${encodeURIComponent(id)}/disable`, { method: 'POST' });
    const updated = await api('/api/admin/users'); state.adminUsers = updated.users; render();
    notify(result.disabled ? 'This account has been paused.' : 'This account is active again.');
  } catch (error) { notify(error.message, true); }
}

async function focusSearchPost(postId) {
  state.searchOpen = false; state.searchQuery = ''; state.searchResults = null; await goFeed('all');
  requestAnimationFrame(() => {
    const card = app.querySelector(`[data-post-id="${CSS.escape(postId)}"]`);
    card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (card) { card.classList.add('highlight-post'); setTimeout(() => card.classList.remove('highlight-post'), 1800); }
  });
}

let searchTimer;
async function search(value) {
  state.searchQuery = value; state.searchResults = null; state.searchOpen = Boolean(value.trim());
  updateSearchPopover(); clearTimeout(searchTimer);
  if (!value.trim()) return;
  const query = value.trim();
  searchTimer = setTimeout(async () => {
    try {
      const results = await api(`/api/search?q=${encodeURIComponent(query)}`);
      if (state.searchQuery.trim() !== query) return;
      state.searchResults = results; state.searchOpen = true; updateSearchPopover();
    } catch {
      if (state.searchQuery.trim() === query) { state.searchResults = { users: [], posts: [], error: true }; state.searchOpen = true; updateSearchPopover(); }
    }
  }, 250);
}

function updateSearchPopover() {
  app.querySelector('.search-popover')?.remove();
  const topbarElement = app.querySelector('.topbar');
  if (topbarElement && state.searchOpen && state.searchQuery.trim()) topbarElement.insertAdjacentHTML('beforeend', searchPopover());
}

app.addEventListener('input', (event) => {
  if (event.target.id === 'global-search') search(event.target.value);
  if (event.target.matches('.chat-compose input')) noteTyping(event.target);
});

app.addEventListener('focusout', (event) => {
  if (event.target.matches('.chat-compose input')) stopTyping();
});

app.addEventListener('focusin', (event) => {
  if (event.target.id === 'global-search' && state.searchQuery) { state.searchOpen = true; updateSearchPopover(); }
});

app.addEventListener('change', (event) => {
  if (event.target.matches('[data-input="media-file"]')) {
    const file = event.target.files?.[0];
    if (!file) return;
    const max = state.composeType === 'picture' ? 12 * 1024 * 1024 : 50 * 1024 * 1024;
    if (file.size > max) { notify(`Choose a file smaller than ${state.composeType === 'picture' ? '12 MB' : '50 MB'}.`, true); return; }
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.selectedFile = file; state.previewUrl = URL.createObjectURL(file); render();
  }
  if (event.target.matches('[data-input="story-file"]')) {
    const file = event.target.files?.[0]; if (!file) return;
    const kind = storyFileKind(file);
    const limit = kind === 'video' ? 50 * 1024 * 1024 : 12 * 1024 * 1024;
    const status = app.querySelector('[data-story-file-name]');
    if (!kind) {
      state.storyFile = null; event.target.value = '';
      if (status) status.textContent = 'That file type is not supported. Choose a picture or video.';
      notify('Choose a JPG, PNG, WebP, GIF, AVIF, MP4, WebM or MOV file.', true); return;
    }
    if (file.size > limit) {
      state.storyFile = null; event.target.value = '';
      if (status) status.textContent = kind === 'video' ? 'That video is over 50 MB.' : 'That picture is over 12 MB.';
      notify(kind === 'video' ? 'Choose a video under 50 MB.' : 'Choose a picture under 12 MB.', true); return;
    }
    state.storyFile = file;
    if (status) { status.textContent = `Ready to share: ${file.name}`; status.classList.add('selected'); }
  }
  if (event.target.matches('[data-input="avatar-file"]')) {
    const file = event.target.files?.[0]; if (!file) return;
    if (file.size > 12 * 1024 * 1024) { notify('Choose a profile picture under 12 MB.', true); return; }
    const form = event.target.closest('form');
    state.profileDraft = { username: form.elements.username.value, bio: form.elements.bio.value };
    state.avatarFile = file; render();
  }
});

app.addEventListener('click', (event) => {
  const actionTarget = event.target.closest('[data-action]');
  if (!actionTarget) {
    if (state.searchOpen && !event.target.closest('.search-box, .search-popover')) { state.searchOpen = false; updateSearchPopover(); }
    return;
  }
  const action = actionTarget.dataset.action;
  if (action === 'backdrop') {
    if (event.target === actionTarget) { resetCompose(); render(); }
    return;
  }
  if (action === 'open-profile') navigateAction(action, actionTarget);
  else navigateAction(action, actionTarget);
});

app.addEventListener('submit', async (event) => {
  const form = event.target;
  const kind = form.dataset.form;
  if (!kind) return;
  event.preventDefault();
  if (kind === 'auth') return submitAuth(form);
  if (kind === 'compose') {
    if (state.composeType !== 'idea' && !state.selectedFile) { notify('Choose a file before publishing.', true); return; }
    xhrUpload(form); return;
  }
  if (kind === 'comment') return submitComment(form);
  if (kind === 'story') return submitStory(form);
  if (kind === 'message') return submitMessage(form);
  if (kind === 'edit-profile') {
    const submit = form.querySelector('button[type="submit"]'); submit.disabled = true;
    try {
      const result = await api('/api/profile', { method: 'PATCH', json: { username: form.elements.username.value.trim(), bio: form.elements.bio.value } });
      state.user = result.user;
      if (state.avatarFile) {
        const data = new FormData(); data.set('avatar', state.avatarFile, state.avatarFile.name);
        const photo = await api('/api/profile/avatar', { method: 'POST', body: data }); state.user = photo.user;
      }
      state.modal = null; state.profileDraft = null; state.avatarFile = null;
      await loadProfile(state.user.username); render(); notify('Your profile has been updated.');
    } catch (error) { submit.disabled = false; notify(error.message, true); }
  }
});

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault(); const searchInput = app.querySelector('#global-search'); searchInput?.focus();
  }
  if (event.key === 'Escape' && state.modal) { resetCompose(); render(); }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.page === 'messages') void syncMessagePage();
});

window.addEventListener('popstate', async () => {
  const params = new URL(location.href).searchParams;
  const profile = params.get('profile');
  state.modal = null; state.selectedPostId = null;
  if (profile) { await loadProfile(profile, { push: false }); return; }
  if (params.get('admin') === '1' && state.user?.role === 'admin') { await loadAdmin({ push: false }); return; }
  if (params.get('page') === 'friends') { await loadFriends({ push: false }); return; }
  if (params.get('page') === 'messages') { await loadMessages(null, { push: false }); return; }
  state.page = 'home'; state.profile = null;
  const requestedType = params.get('feed'); state.feedType = ['video', 'picture', 'idea'].includes(requestedType) ? requestedType : 'all';
  render(); await loadFeed();
});

async function boot() {
  render();
  try {
    const session = await api('/api/session'); state.user = session.user; state.csrfToken = session.csrfToken;
    await refreshCommunityData();
    const params = new URL(location.href).searchParams;
    const requestedProfile = params.get('profile');
    if (requestedProfile) await loadProfile(requestedProfile, { push: false });
    else if (params.get('admin') === '1' && state.user?.role === 'admin') await loadAdmin({ push: false });
    else if (['friends', 'messages'].includes(params.get('page'))) params.get('page') === 'friends' ? await loadFriends({ push: false }) : await loadMessages(null, { push: false });
    else {
      const requestedType = params.get('feed'); state.feedType = ['video', 'picture', 'idea'].includes(requestedType) ? requestedType : 'all';
      const [feed, stories] = await Promise.all([api(`/api/feed?type=${encodeURIComponent(state.feedType)}`), api('/api/stories')]); state.posts = feed.posts; state.stories = stories.stories;
    }
    if (requestedProfile || params.get('admin') === '1' || ['friends', 'messages'].includes(params.get('page'))) {
      const stories = await api('/api/stories'); state.stories = stories.stories;
    }
  } catch (error) { console.error(error); }
  render();
}

boot();


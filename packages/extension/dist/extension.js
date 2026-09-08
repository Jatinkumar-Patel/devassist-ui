import * as vscode from 'vscode';
const PARTICIPANT_ID = 'devassist.triage';
const EXTENSION_ID = 'jatinkumar-patel.devassist';
const MODEL_STATE_KEY = 'devassist.selectedModelId';
const AGENT_STATE_KEY = 'devassist.selectedAgent';
const AGENTS = [
    {
        id: 'triage-l2',
        label: 'L2 Triage Agent',
        description: 'Balanced triage with verdict, confidence, and next step.',
        systemPrompt: [
            'You are a Sunrise product support engineer performing Level-2 triage on a DevAssist work item.',
            'Be concise, technical, and evidence-backed.',
            'Prefer one clear verdict, confidence, blind spots, and next step.',
        ].join('\n'),
    },
    {
        id: 'root-cause',
        label: 'Root Cause Agent',
        description: 'Build the strongest observed -> mechanism -> impact chain.',
        systemPrompt: [
            'You are a root-cause analysis assistant for Sunrise support triage.',
            'Emphasize cause chains, triggering conditions, and the most likely failure mechanism.',
            'Separate trigger, mechanism, and user-visible impact.',
        ].join('\n'),
    },
    {
        id: 'log-forensics',
        label: 'Log Forensics Agent',
        description: 'Prioritize stack traces, timelines, and repeated signatures.',
        systemPrompt: [
            'You are a log forensics assistant for DevAssist.',
            'Prioritize timing, repeated signatures, stack traces, and missing correlation clues.',
            'Call out what the logs prove versus what remains unknown.',
        ].join('\n'),
    },
    {
        id: 'l2-commentary',
        label: 'L2 Commentary Agent',
        description: 'Generate stakeholder-ready commentary from evidence.',
        systemPrompt: [
            'You are a stakeholder-facing L2 commentary assistant.',
            'Keep the answer concise, readable, and evidence-backed.',
            'Avoid filler and provide a clear next action.',
        ].join('\n'),
    },
];
function agentFromValue(value) {
    const normalized = String(value ?? 'triage-l2').trim().toLowerCase();
    return AGENTS.some((agent) => agent.id === normalized) ? normalized : 'triage-l2';
}
function agentLabel(agent) {
    return AGENTS.find((item) => item.id === agent)?.label ?? agent;
}
function getAgentDefinition(agent) {
    return AGENTS.find((item) => item.id === agent) ?? AGENTS[0];
}
function modelLabel(model) {
    const bits = [model.vendor, model.family, model.id].filter(Boolean);
    return bits.join(' · ');
}
async function quickPickModel(context) {
    const models = await vscode.lm.selectChatModels();
    if (!models.length) {
        void vscode.window.showWarningMessage('No VS Code chat models are available in this profile.');
        return;
    }
    const storedId = context.globalState.get(MODEL_STATE_KEY);
    const pick = await vscode.window.showQuickPick(models.map((model) => ({
        label: modelLabel(model),
        description: storedId === model.id ? 'current selection' : model.vendor,
        detail: model.family,
        model,
    })), {
        title: 'Select DevAssist AI Model',
        placeHolder: 'Choose the VS Code model DevAssist should use',
    });
    if (!pick)
        return;
    await context.globalState.update(MODEL_STATE_KEY, pick.model.id);
    void vscode.window.showInformationMessage(`DevAssist model set to ${pick.label}`);
}
async function quickPickAgent(context) {
    const storedAgent = agentFromValue(context.globalState.get(AGENT_STATE_KEY));
    const pick = await vscode.window.showQuickPick(AGENTS.map((agent) => ({
        label: agent.label,
        description: storedAgent === agent.id ? 'current selection' : agent.description,
        detail: agent.systemPrompt.split('\n')[1],
        agent,
    })), {
        title: 'Select DevAssist AI Agent',
        placeHolder: 'Choose the DevAssist reasoning mode',
    });
    if (!pick)
        return;
    await context.globalState.update(AGENT_STATE_KEY, pick.agent.id);
    void vscode.window.showInformationMessage(`DevAssist agent set to ${pick.agent.label}`);
}
function getSelectedAgent(context) {
    const configured = vscode.workspace.getConfiguration('devassist').get('defaultAgent');
    const stored = context.globalState.get(AGENT_STATE_KEY);
    return agentFromValue(stored ?? configured);
}
function buildPrompt(context, requestPrompt) {
    const agent = getSelectedAgent(context);
    const agentDefinition = getAgentDefinition(agent);
    return `${agentDefinition.systemPrompt}\n\nUser request:\n${requestPrompt}`;
}
function previousAssistantMessages(context) {
    const messages = [];
    for (const turn of context.history) {
        if (!(turn instanceof vscode.ChatResponseTurn))
            continue;
        let responseText = '';
        for (const part of turn.response) {
            if (part instanceof vscode.ChatResponseMarkdownPart) {
                responseText += part.value.value;
            }
        }
        if (responseText.trim()) {
            messages.push(vscode.LanguageModelChatMessage.Assistant(responseText));
        }
    }
    return messages;
}
async function openDevAssistChat() {
    try {
        await vscode.commands.executeCommand('workbench.action.chat.open');
    }
    catch {
        // If the chat view command is unavailable, fall back to an information message.
    }
}
async function handleDeepLink(context, uri) {
    if (uri.authority !== EXTENSION_ID)
        return;
    if (uri.path === '/open-chat') {
        await openDevAssistChat();
        const prompt = new URLSearchParams(uri.query).get('prompt');
        if (prompt) {
            void vscode.window.showInformationMessage(`DevAssist chat opened for: ${prompt}`);
        }
        return;
    }
    if (uri.path === '/select-model') {
        await quickPickModel(context);
        return;
    }
    if (uri.path === '/select-agent') {
        await quickPickAgent(context);
        return;
    }
    if (uri.path === '/show-status') {
        const models = await vscode.lm.selectChatModels();
        const agent = getSelectedAgent(context);
        const storedModelId = context.globalState.get(MODEL_STATE_KEY);
        const currentModel = models.find((model) => model.id === storedModelId) ?? models[0];
        const lines = [
            `Agent: ${agentLabel(agent)}`,
            `Model: ${currentModel ? modelLabel(currentModel) : 'No model available'}`,
            `Available models: ${models.length}`,
        ];
        void vscode.window.showInformationMessage(lines.join(' | '));
    }
}
export function activate(context) {
    const handler = async (request, chatContext, stream, token) => {
        const agent = getSelectedAgent(context);
        const messages = [
            vscode.LanguageModelChatMessage.User(buildPrompt(context, request.prompt)),
            ...previousAssistantMessages(chatContext),
        ];
        stream.markdown(`Using **${agentLabel(agent)}** with the model selected in VS Code.\n\n`);
        try {
            const response = await request.model.sendRequest(messages, {}, token);
            for await (const chunk of response.text) {
                stream.markdown(chunk);
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            stream.markdown(`DevAssist could not complete the request: ${message}`);
        }
    };
    const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
    participant.iconPath = new vscode.ThemeIcon('sparkle');
    context.subscriptions.push(vscode.window.registerUriHandler({
        handleUri: (uri) => handleDeepLink(context, uri),
    }), participant, vscode.commands.registerCommand('devassist.openChat', async () => {
        const agent = getSelectedAgent(context);
        const models = await vscode.lm.selectChatModels();
        const currentModelId = context.globalState.get(MODEL_STATE_KEY);
        const currentModel = models.find((model) => model.id === currentModelId) ?? models[0];
        if (!currentModel) {
            void vscode.window.showWarningMessage('No VS Code chat models are available. Enable a provider first.');
            return;
        }
        void vscode.window.showInformationMessage(`Open the VS Code Chat view and use @devassist.triage. Current agent: ${agentLabel(agent)}, current model: ${modelLabel(currentModel)}.`);
    }), vscode.commands.registerCommand('devassist.selectModel', () => quickPickModel(context)), vscode.commands.registerCommand('devassist.selectAgent', () => quickPickAgent(context)), vscode.commands.registerCommand('devassist.showStatus', async () => {
        const models = await vscode.lm.selectChatModels();
        const agent = getSelectedAgent(context);
        const storedModelId = context.globalState.get(MODEL_STATE_KEY);
        const currentModel = models.find((model) => model.id === storedModelId) ?? models[0];
        const lines = [
            `Agent: ${agentLabel(agent)}`,
            `Model: ${currentModel ? modelLabel(currentModel) : 'No model available'}`,
            `Available models: ${models.length}`,
        ];
        void vscode.window.showInformationMessage(lines.join(' | '));
    }));
}
export function deactivate() {
    // nothing to clean up
}
//# sourceMappingURL=extension.js.map
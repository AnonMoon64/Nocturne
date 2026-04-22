/**
 * Nocturne Memory Engine
 * Handles fact extraction, world state updates, and dynamic summarization.
 */

export const MemoryEngine = {
    /**
     * Extracts facts and state updates from LLM output.
     * Pattern: [FACT: description] or [STATE: plot/location/relation : description]
     */
    processOutput(char, text) {
        const factRegex = /\[FACT:\s*(.*?)\]/g;
        const stateRegex = /\[STATE:\s*(plot|location|relation)\s*:\s*(.*?)\]/g;
        
        let match;
        while ((match = factRegex.exec(text)) !== null) {
            const fact = match[1].trim();
            if (!char.memories.includes(fact)) char.memories.push(fact);
        }

        while ((match = stateRegex.exec(text)) !== null) {
            const type = match[1].trim();
            const update = match[2].trim();
            if (type === 'plot' && !char.world_state.plot_points.includes(update)) char.world_state.plot_points.push(update);
            if (type === 'location' && !char.world_state.locations.includes(update)) char.world_state.locations.push(update);
            if (type === 'relation' && !char.world_state.relationships.includes(update)) char.world_state.relationships.push(update);
        }
    },

    /**
     * Searches memories for keywords in the current message and returns relevant snippets.
     */
    injectRelevantMemories(char, currentInput) {
        if (!char.memories || char.memories.length === 0) return "";
        
        const keywords = currentInput.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const relevant = char.memories.filter(mem => 
            keywords.some(kw => mem.toLowerCase().includes(kw))
        ).slice(0, 5);

        if (relevant.length === 0) return "";
        return `### RELEVANT MEMORIES:\n- ${relevant.join('\n- ')}`;
    },

    /**
     * Triggers a summarization of the chat history.
     */
    async generateSummary(history, getBaseUrl) {
        const prompt = [
            { role: "system", content: "Summarize the major events of this conversation so far into 3 concise sentences. Focus on plot and character development." },
            ...history.slice(-10)
        ];

        try {
            const res = await fetch(`${getBaseUrl()}/v1/chat/completions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages: prompt, model: "default", stream: false })
            });
            const data = await res.json();
            return data.choices[0].message.content;
        } catch (e) {
            return null;
        }
    }
};

import json
from typing import Annotated, TypedDict

from langchain_core.messages import BaseMessage, SystemMessage, HumanMessage, AIMessage, ToolMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START, END
from langgraph.prebuilt import ToolNode

from .tools import ALL_TOOLS

class UserContext(TypedDict):
    user_id: str
    env: str
    token: str

class AgentState(TypedDict):
    messages: list[BaseMessage]
    user_context: UserContext
    artifacts: list[dict]

def create_agent_graph(api_key: str, base_url: str, model_name: str, system_prompt: str = "", temperature: float = 0.2):
    """
    Builds a LangGraph state machine with tools.
    """
    
    # 1. Initialize LLM with Tools
    llm = ChatOpenAI(
        api_key=api_key,
        base_url=base_url,
        model=model_name,
        temperature=temperature,
        streaming=True
    )
    llm_with_tools = llm.bind_tools(ALL_TOOLS)

    # 2. Define Nodes
    async def chatbot_node(state: AgentState):
        """Main LLM node: decides whether to call tools or respond."""
        # Inject system prompt if present and not already in history
        messages = state["messages"]
        if system_prompt and not isinstance(messages[0], SystemMessage):
             messages = [SystemMessage(content=system_prompt)] + messages
        
        response = await llm_with_tools.ainvoke(messages)
        return {"messages": [response]}

    tool_node = ToolNode(ALL_TOOLS)

    # 3. Define Conditional Edge (Router)
    def should_continue(state: AgentState):
        last_message = state["messages"][-1]
        # If LLM calls tools -> go to "tools" node
        if hasattr(last_message, "tool_calls") and last_message.tool_calls:
            return "tools"
        # Otherwise -> end
        return END

    # 4. Build Graph
    workflow = StateGraph(AgentState)
    workflow.add_node("agent", chatbot_node)
    workflow.add_node("tools", tool_node)

    workflow.add_edge(START, "agent")
    workflow.add_conditional_edges("agent", should_continue, ["tools", END])
    workflow.add_edge("tools", "agent")  # Loop back to agent after tool execution

    return workflow.compile()

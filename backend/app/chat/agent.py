import json
from typing import Annotated, TypedDict

from langchain_core.messages import BaseMessage, SystemMessage, HumanMessage, AIMessage, ToolMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode

from .tools import ALL_TOOLS

class UserContext(TypedDict):
    user_id: str
    env: str
    token: str

class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    user_context: UserContext
    artifacts: list[dict]

def create_agent_graph(api_key: str, base_url: str, model_name: str, system_prompt: str = "", temperature: float = 0.2):
    """
    Builds a LangGraph state machine with tools.
    """
    
    llm = ChatOpenAI(
        api_key=api_key,
        base_url=base_url,
        model=model_name,
        temperature=temperature,
        streaming=True
    )
    llm_with_tools = llm.bind_tools(ALL_TOOLS)

    async def chatbot_node(state: AgentState):
        """Main LLM node: decides whether to call tools or respond."""
        messages = state["messages"]
        if system_prompt and (not messages or not isinstance(messages[0], SystemMessage)):
            messages = [SystemMessage(content=system_prompt)] + messages
        
        response = await llm_with_tools.ainvoke(messages)
        return {"messages": [response]}

    tool_node = ToolNode(ALL_TOOLS)

    def should_continue(state: AgentState):
        last_message = state["messages"][-1]
        if hasattr(last_message, "tool_calls") and last_message.tool_calls:
            return "tools"
        return END

    workflow = StateGraph(AgentState)
    workflow.add_node("agent", chatbot_node)
    workflow.add_node("tools", tool_node)

    workflow.add_edge(START, "agent")
    workflow.add_conditional_edges("agent", should_continue, ["tools", END])
    workflow.add_edge("tools", "agent")

    return workflow.compile()

-- 读取 Studio 控制台/Output 日志（print / warning / error）。

local LogService = game:GetService("LogService")

local M = {}

local TYPE_NAMES: { [Enum.MessageType]: string } = {
	[Enum.MessageType.MessageOutput] = "Output",
	[Enum.MessageType.MessageInfo] = "Info",
	[Enum.MessageType.MessageWarning] = "Warning",
	[Enum.MessageType.MessageError] = "Error",
}

function M.get_console_output(args: any)
	local count = (args and args.count) or 100
	local filter = args and args.includeTypes -- 形如 {"Error","Warning"}

	local history = LogService:GetLogHistory()
	local out = {}
	for _, entry in ipairs(history) do
		local typeName = TYPE_NAMES[entry.messageType] or tostring(entry.messageType)
		if not filter or table.find(filter, typeName) then
			table.insert(out, {
				message = entry.message,
				type = typeName,
				timestamp = entry.timestamp,
			})
		end
	end

	-- 只保留最近 count 条。
	if #out > count then
		local trimmed = {}
		for i = #out - count + 1, #out do
			table.insert(trimmed, out[i])
		end
		out = trimmed
	end

	return { count = #out, messages = out }
end

return M

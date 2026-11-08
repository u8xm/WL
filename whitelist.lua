local HttpService = game:GetService("HttpService")
local CHECK_URL = "https://YOUR-APP.up.railway.app/check"

local ownerId
if game.CreatorType == Enum.CreatorType.Group then
	local ok, info = pcall(function()
		return game:GetService("GroupService"):GetGroupInfoAsync(game.CreatorId)
	end)
	ownerId = ok and info and info.Owner and info.Owner.Id
elseif game.CreatorId ~= 0 then
	ownerId = game.CreatorId
end

local whitelisted = false
if ownerId then
	for _ = 1, 3 do
		local ok, body = pcall(function()
			return HttpService:GetAsync(`{CHECK_URL}?userid={ownerId}`, true)
		end)
		local decodedOk, decoded = pcall(function()
			return ok and HttpService:JSONDecode(body)
		end)
		if decodedOk and type(decoded) == "table" and decoded.whitelisted then
			whitelisted = true
			break
		end
		task.wait(2)
	end
end

if not whitelisted then
	print("Not Whitelisted")
	return
end
print("Whitelisted")

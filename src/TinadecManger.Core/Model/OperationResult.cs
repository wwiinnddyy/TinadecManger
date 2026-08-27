namespace TinadecManger.Core.Model;

/// <summary>Outcome of a user-facing manager operation (register/start/stop/save).</summary>
public sealed record OperationResult(bool Ok, string Message)
{
    public static OperationResult Success(string message) => new(true, message);
    public static OperationResult Failure(string message) => new(false, message);
}
